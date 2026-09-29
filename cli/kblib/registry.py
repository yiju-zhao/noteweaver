"""Read the selected instance vocabulary."""

import json
import re
from dataclasses import dataclass, field

from .layout import load as load_layout


class RegistryError(ValueError):
    pass


@dataclass
class Term:
    key: str
    predicate: bool
    vtype: str
    multi: bool
    subject: list
    object: list = field(default_factory=list)
    unit: str = ""
    values: list = field(default_factory=list)
    label: str = ""
    inverse_of: str = ""
    counterpart: str = ""


@dataclass
class Registry:
    kind_dirs: dict
    class_dirs: dict
    terms: dict
    scope_keys: dict
    units: dict
    problems: list
    place_claim: set = field(default_factory=set)
    fm_required: dict = field(default_factory=dict)
    data: dict = field(default_factory=dict)


def _unique(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise RegistryError(f"duplicate JSON key {key!r}")
        out[key] = value
    return out


def _fields(obj, fields, where):
    if not isinstance(obj, dict):
        raise RegistryError(f"{where}: expected an object")
    for key, cls in fields.items():
        if key not in obj or not isinstance(obj[key], cls):
            raise RegistryError(f"{where}.{key}: missing or invalid {cls.__name__}")


def _strings(values, where):
    if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
        raise RegistryError(f"{where}: expected a list of strings")
    if len(set(values)) != len(values):
        raise RegistryError(f"{where}: duplicate values")


def _spec(items, kinds, classes, where, same=False):
    if not isinstance(items, list):
        raise RegistryError(f"{where}: expected a list")
    out = []
    for item in items:
        _fields(item, {"type": str}, where)
        t, c = item['type'], item.get('class')
        if t not in kinds:
            raise RegistryError(f"{where}: unknown type {t!r}")
        if c is not None:
            if c == 'SAME' and same and t == 'entity':
                pass
            else:
                _strings(c, where + '.class')
                if t != 'entity' or not c or any(v not in classes for v in c):
                    raise RegistryError(f"{where}: unknown entity class")
        out.append((t, c))
    return out


def jev_values(data, vocabulary):
    """JEV compiler input; definitions live on the terms, order on the question."""
    if vocabulary in ('predicate', 'attribute'):
        values = {k: v['jev'] for k, v in data[vocabulary + 's'].items()}
    elif vocabulary == 'kind':
        values = {k: v['jev'] for k, v in data['kinds'].items()}
    else:
        values = {v['class']: v['jev'] for v in data['directories'].values() if v['class']}
    extra = data['jev'][vocabulary]['extra_values']
    if values.keys() & extra.keys():
        raise RegistryError(f"jev.{vocabulary}: extra_values duplicates a vocabulary entry")
    return {**values, **extra}


def load(root):
    try:
        data = json.loads(load_layout(root).path("schema").read_text(encoding='utf-8'), object_pairs_hook=_unique)
        return _load(data, load_layout(root).path("bank").relative_to(load_layout(root).vault).as_posix())
    except (OSError, ValueError, KeyError, TypeError, re.error) as e:
        raise RegistryError(f"schema: {e}") from e


def _load(data, bank="bank"):
    _fields(data, {k: dict for k in ('kinds', 'directories', 'predicates', 'attributes',
                                    'scope_keys', 'units', 'enums', 'jev', 'formats')}, 'schema')
    if data.get('version') != 3:
        raise RegistryError(f"unsupported version {data.get('version')!r}; expected 3")
    for key in ('base_required', 'special_values'):
        _strings(data.get(key), key)
    _fields(data['formats'], {'quantity': str, 'wikilink': str, 'time': list}, 'formats')
    _strings(data['formats']['time'], 'formats.time')
    for pattern in [data['formats']['quantity'], data['formats']['wikilink'], *data['formats']['time']]:
        re.compile(pattern)

    kind_dirs, class_dirs, required = {}, {}, {}
    for kind, entry in data['kinds'].items():
        _fields(entry, {k: str for k in ('directory', 'label', 'meaning', 'not_for', 'examples')}, f'kinds.{kind}')
        if not re.fullmatch(r'[a-z-]+', entry['directory']):
            raise RegistryError(f'kinds.{kind}: invalid directory')
        kind_dirs[kind] = entry['directory']
    if 'entity' not in kind_dirs or len(set(kind_dirs.values())) != len(kind_dirs):
        raise RegistryError('kinds: missing entity or duplicate directories')
    bindings = set()
    for path, entry in data['directories'].items():
        _fields(entry, {'type': str, 'icon': str, 'required': list}, f'directories.{path}')
        t, cls = entry['type'], entry['class']
        if t not in kind_dirs or (t == 'entity') != isinstance(cls, str) or (t != 'entity' and cls is not None):
            raise RegistryError(f'directories.{path}: invalid type/class binding')
        prefix = f'{bank}/{kind_dirs[t]}'
        if cls:
            _fields(entry, {'meaning': str, 'jev': dict}, f'directories.{path}')
            if not path.startswith(prefix + '/') or not re.fullmatch(r'[a-z-]+', path[len(prefix)+1:]):
                raise RegistryError(f'directories.{path}: invalid entity directory')
            class_dirs[cls] = path[len(prefix)+1:]
        elif path != prefix:
            raise RegistryError(f'directories.{path}: differs from kinds.{t}.directory')
        if (t, cls) in bindings:
            raise RegistryError(f'directories.{path}: duplicate type/class binding')
        bindings.add((t, cls))
        _strings(entry['required'], f'directories.{path}.required')
        required[(t, cls)] = entry['required']
    if any((t, None) not in bindings for t in kind_dirs if t != 'entity') or not class_dirs:
        raise RegistryError('directories: missing Kind or Entity class binding')

    units = {}
    for key, entry in data['units'].items():
        _fields(entry, {'dimension': str, 'factor': str, 'meaning': str}, f'units.{key}')
        units[key] = entry['dimension']
    for key, values in data['enums'].items():
        if not isinstance(values, dict) or not values or any(not isinstance(v, str) for v in values.values()):
            raise RegistryError(f'enums.{key}: expected values with meanings')
    terms, place_claim = {}, set()
    for group in ('predicates', 'attributes'):
        for key, entry in data[group].items():
            where = f'{group}.{key}'
            _fields(entry, {**{k: str for k in ('label', 'meaning', 'not_for', 'statement', 'value', 'unit', 'place')},
                            'multi': bool, 'subject': list, 'object': list, 'jev': dict}, where)
            if key in terms:
                raise RegistryError(f'{where}: duplicate term')
            vt = entry['value']
            if vt not in ('quantity', 'time', 'enum', 'boolean', 'page'):
                raise RegistryError(f'{where}: unknown value type {vt!r}')
            if group == 'predicates':
                _fields(entry, {'inverse': str, 'inverse_key': str, 'inverse_multi': bool}, where)
                if vt != 'page':
                    raise RegistryError(f'{where}: predicates must have page values')
                if entry['place'] != 'frontmatter':
                    raise RegistryError(f'{where}: paired predicates must allow frontmatter')
            if entry['place'] not in ('frontmatter', 'claim'):
                raise RegistryError(f'{where}: unknown place')
            if entry['place'] == 'claim':
                _fields(entry, {'place_reason': str}, where)
                place_claim.add(key)
            if vt == 'quantity' and entry['unit'] not in units:
                raise RegistryError(f'{where}: unknown unit {entry["unit"]!r}')
            values = list(data['enums'][entry['enum']]) if vt == 'enum' else ['true', 'false'] if vt == 'boolean' else []
            terms[key] = Term(key, group == 'predicates', vt, entry['multi'],
                              _spec(entry['subject'], kind_dirs, class_dirs, where + '.subject'),
                              _spec(entry['object'], kind_dirs, class_dirs, where + '.object', same=True),
                              entry['unit'], values, entry['label'])
    reserved = set(terms) | set(data['base_required']) | {'sources', 'class', 'tags', 'aliases', 'status', 'verified'}
    for key, entry in data['predicates'].items():
        inverse = entry['inverse_key']
        if not re.fullmatch(r'[a-z][a-z0-9_]*', inverse) or inverse in reserved:
            raise RegistryError(f'predicates.{key}: invalid or duplicate inverse_key {inverse!r}')
        reserved.add(inverse)
        term = terms[key]
        term.counterpart = inverse
        same = any(cs == 'SAME' for _, cs in term.object)
        terms[inverse] = Term(inverse, True, 'page', entry['inverse_multi'],
                              [(t, None if cs == 'SAME' else cs) for t, cs in term.object],
                              [(t, 'SAME' if same else cs) for t, cs in term.subject],
                              label=entry['inverse'], inverse_of=key, counterpart=key)
    for binding, keys in required.items():
        for key in keys:
            if key not in terms or terms[key].inverse_of or (terms[key].subject and not any(
                    t == binding[0] and (cs is None or binding[1] in cs) for t, cs in terms[key].subject)):
                raise RegistryError(f'directories.{binding}.required: unavailable key {key!r}')
    scope_keys = {}
    for key, entry in data['scope_keys'].items():
        _fields(entry, {'label': str, 'value': str, 'meaning': str}, f'scope_keys.{key}')
        if entry['value'] not in ('quantity', 'time', 'enum', 'boolean', 'page', 'text'):
            raise RegistryError(f'scope_keys.{key}: unknown value type')
        if entry['value'] == 'quantity' and entry.get('unit') not in units:
            raise RegistryError(f'scope_keys.{key}: unknown unit')
        if entry['value'] == 'enum':
            _strings(entry.get('enum'), f'scope_keys.{key}.enum')
        if entry['value'] == 'page':
            _spec(entry.get('object'), kind_dirs, class_dirs, f'scope_keys.{key}.object')
        scope_keys[key] = entry['value']

    for vocabulary in ('predicate', 'attribute', 'kind', 'entity-class'):
        config = data['jev'][vocabulary]
        _fields(config, {'primitive': str, 'question': dict, 'escape_value': str, 'order': list,
                         'extra_values': dict}, f'jev.{vocabulary}')
        _fields(config['question'], {'en': str, 'focus_en': str}, f'jev.{vocabulary}.question')
        _strings(config['order'], f'jev.{vocabulary}.order')
        values = jev_values(data, vocabulary)
        if set(values) != set(config['order']):
            raise RegistryError(f'jev.{vocabulary}.order: differs from vocabulary entries')
        for key, value in values.items():
            _fields(value, {'what': str, 'not_for': str, 'examples': list}, f'jev.{vocabulary}.{key}')
            _strings(value['examples'], f'jev.{vocabulary}.{key}.examples')
            if 'counter_examples' in value:
                _strings(value['counter_examples'], f'jev.{vocabulary}.{key}.counter_examples')
    return Registry(kind_dirs, class_dirs, terms, scope_keys, units, [], place_claim, required, data)


def index_headings(root):
    """Directory -> heading, read from the two fixed index files."""
    out = {}
    bank = load_layout(root).path("bank")
    for base in ("", "entities/"):
        f = bank / base / "index.md"
        if not f.exists():
            continue
        for m in re.finditer(r"^\* \[([^\]]+)\]\(([a-z-]+)/index\.md\)", f.read_text(encoding="utf-8"), re.M):
            out[base + m.group(2)] = m.group(1)
    return out

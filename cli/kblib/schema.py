"""Render marked vocabulary sections in registry Markdown from the JSON truth."""

import json
import re

from .layout import load as load_layout
from .registry import RegistryError, jev_values


def _render_table(headers, rows):
    def row(cells):
        return '| ' + ' | '.join(str(c).replace('|', r'\|').replace('\n', '<br>') for c in cells) + ' |\n'
    return row(headers) + '|' + '---|' * len(headers) + '\n' + ''.join(row(r) for r in rows)


def _ticks(values):
    return ' '.join(f'`{v}`' for v in values)


def _classes(data, spec):
    out = []
    for item in spec:
        label = data['kinds'][item['type']]['label']
        classes = item.get('class')
        if classes == 'SAME':
            label = f'同一 class 的 {label}'
        elif classes:
            label += '（' + '、'.join(classes) + '）'
        out.append(label)
    return '；'.join(out)


def _value(data, entry):
    value = entry['value']
    label = {'quantity': '数量', 'time': '时间', 'enum': '受控枚举', 'boolean': '布尔',
             'page': 'Page 引用', 'text': '文本'}[value]
    if value == 'quantity':
        label += f'，`{entry["unit"]}`'
    elif value == 'enum':
        label += '：' + '、'.join(f'`{v}`' for v in entry['enum']) if isinstance(entry['enum'], list) else '，见下表'
    elif value == 'page' and entry.get('object'):
        label += '（' + _classes(data, entry['object']) + '）'
    return label


def render_jev(data, vocabulary):
    """Compile structured JEV definitions with stable quoting, order and layout."""
    config = data['jev'][vocabulary]
    values = jev_values(data, vocabulary)
    quote = lambda s: json.dumps(s, ensure_ascii=False)
    lines = ['```yaml', f'vocabulary: {vocabulary}', f'primitive: {config["primitive"]}', 'question:']
    lines.extend(f'  {k}: {quote(v)}' for k, v in config['question'].items())
    lines.extend([f'escape_value: {config["escape_value"]}', 'values:'])
    for key in config['order']:
        value = values[key]
        lines.extend([f'  {key}:', f'    what: {quote(value["what"])}',
                      f'    not_for: {quote(value["not_for"])}'])
        for field in ('examples', 'counter_examples'):
            if field in value:
                lines.append(f'    {field}:' + ('' if value[field] else ' []'))
                lines.extend(f'      - {quote(example)}' for example in value[field])
    return '\n'.join([*lines, '```', ''])


def sections(reg, prefix=".kb/policies"):
    data = reg.data
    attributes = {}
    for group in ('predicates', 'attributes'):
        predicate = group == 'predicates'
        headers = ['谓词' if predicate else '属性', '中文', '主语']
        headers += ['宾语', '值数', '反向字段', '反向值数'] if predicate else ['值类型', '值数']
        headers += ['陈述模板', '含义', '不用于']
        rows = []
        for key, entry in data[group].items():
            multi = ('多值' if entry['multi'] else '单值') + ('；' + entry['multi_note'] if entry.get('multi_note') else '')
            row = [f'`{key}`', entry['label'], _classes(data, entry['subject'])]
            row += [_classes(data, entry['object']), multi, f"`{entry['inverse_key']}`（{entry['inverse']}）",
                    '多值' if entry['inverse_multi'] else '单值'] if predicate else [_value(data, entry), multi]
            rows.append([*row, entry['statement'], entry['meaning'], entry['not_for']])
        attributes[group] = _render_table(headers, rows)
        attributes['jev-' + group[:-1]] = render_jev(data, group[:-1])
    attributes['enums'] = '\n'.join(
        f'`{key}`\n\n' + _render_table(['取值', '含义'], [(f'`{v}`', meaning) for v, meaning in values.items()])
        for key, values in data['enums'].items())
    attributes['scope-keys'] = _render_table(['键', '中文', '值类型', '说明'], [
        (f'`{key}`', e['label'], _value(data, e), e['meaning']) for key, e in data['scope_keys'].items()])
    attributes['claim-only'] = _render_table(['只写断言的属性', '原因'], [
        (f'`{key}`', e['place_reason']) for group in ('predicates', 'attributes')
        for key, e in data[group].items() if e['place'] == 'claim'])
    attributes['required'] = _render_table(['类型', '必填'], [
        (_classes(data, [{'type': e['type'], **({'class': [e['class']]} if e['class'] else {})}]), _ticks(e['required']))
        for e in data['directories'].values() if e['required']])
    kinds = {
        'kinds': _render_table(['Kind', '目录', '归这里', '不归这里（该去哪）', '例子'], [
            (e['label'], f'`{e["directory"]}/' + ('<子类>/' if key == 'entity' else '') + '`',
             e['meaning'], e['not_for'], e['examples']) for key, e in data['kinds'].items()]),
        'classes': _render_table(['`class`', '目录', '范围'], [
            (e['class'], f'`{reg.class_dirs[e["class"]]}/`', e['meaning'])
            for e in data['directories'].values() if e['class']]),
        'jev-kind': render_jev(data, 'kind'), 'jev-entity-class': render_jev(data, 'entity-class'),
    }
    units = {'units': _render_table(['代码', '量纲', '相对基准的倍数', '说明'], [
        (f'`{key}`', e['dimension'], e['factor'], e['meaning']) for key, e in data['units'].items()])}
    return {f'{prefix}/attributes.md': attributes, f'{prefix}/kinds.md': kinds,
            f'{prefix}/units.md': units}


def _replace(text, blocks, rel):
    for key, content in blocks.items():
        start, end = f'<!-- kb:{key}:start -->', f'<!-- kb:{key}:end -->'
        if text.count(start) != 1 or text.count(end) != 1 or text.index(start) > text.index(end):
            raise RegistryError(f'{rel}: missing or duplicate {key} markers; restore the markers from git')
        # Callable replacement keeps backslashes in YAML literals and regular expressions literal.
        text = re.sub(re.escape(start) + r'.*?' + re.escape(end),
                      lambda m: start + '\n' + content + end, text, flags=re.S)
    expected = {f'<!-- kb:{key}:{edge} -->' for key in blocks for edge in ('start', 'end')}
    actual = set(re.findall(r'<!-- kb:[^\n]*? -->', text))
    if actual != expected:
        raise RegistryError(f'{rel}: unknown generated-section markers')
    return text


def stale(root, reg):
    """Paths and reasons; missing markers are stale too, never silently re-created."""
    out = {}
    for rel, blocks in sections(reg, load_layout(root).rel("policies")).items():
        try:
            text = (root / rel).read_text(encoding='utf-8')
            expected = _replace(text, blocks, rel)
            if text != expected:
                out[rel] = 'differs from kb-schema.json; run kb schema'
        except (OSError, RegistryError) as e:
            out[rel] = str(e)
    return out


def write(root, reg):
    """Render all sections before writing; never change the JSON or unmarked prose."""
    rendered = {rel: _replace((root / rel).read_text(encoding='utf-8'), blocks, rel)
                for rel, blocks in sections(reg, load_layout(root).rel("policies")).items()}
    changed = []
    for rel, content in rendered.items():
        path = root / rel
        if path.read_text(encoding='utf-8') != content:
            path.write_text(content, encoding='utf-8')
            changed.append(rel)
    return changed

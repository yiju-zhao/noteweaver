import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'manifest.json').read_text())['version']
spec = importlib.util.spec_from_file_location('installer', ROOT / 'scripts/install.py')
installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)

class InstallationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.vault = self.root / 'notebook'
        self.metadata = self.vault / '.noteweaver'; self.metadata.mkdir(parents=True)
        (self.metadata / 'config.json').write_text('{"version":1,"repository_root":".."}')
        (self.metadata / 'schema.json').write_text('{"version":3}')
        self.destination = self.vault / '.obsidian/plugins/noteweaver'; self.destination.mkdir(parents=True)
        self.state = b'{"actor":"human:demo","relations":{"edges":[]}}'
        (self.destination / 'data.json').write_bytes(self.state)
        self.lock = {'repository':'yiju-zhao/noteweaver', 'version':VERSION, 'schema_version':3,
                     'source_commit':'a'*40, 'assets':{p:installer.digest((ROOT/'dist'/p).read_bytes()) for p in installer.ASSETS}}
        self.plugin = self.root / '.agents/plugins/noteweaver'
    def install(self, **kw):
        return installer.install(self.metadata,self.lock,ROOT/'dist',**kw)
    def test_release_installs_all_skills_preserves_state_and_is_idempotent(self):
        self.install(); receipt=json.loads((self.metadata/'installation.json').read_text())
        self.assertEqual(len(receipt['skills']),9)
        self.assertTrue((self.plugin/'skills/noteweaver-init/SKILL.md').is_file())
        self.assertTrue((self.plugin/'skills/archify/bin/archify.mjs').is_file())
        self.assertFalse((self.metadata/'runtime/skills').exists())
        self.assertEqual((self.destination/'data.json').read_bytes(),self.state)
        with patch.object(installer,'replace_installation') as replace, patch.object(installer,'download') as download:
            self.install(); replace.assert_not_called(); download.assert_not_called()
        (self.plugin/'skills/noteweaver-query/SKILL.md').write_text('broken')
        self.install(); self.assertIn('name: noteweaver-query',(self.plugin/'skills/noteweaver-query/SKILL.md').read_text())
    def test_bad_release_hash_does_not_change_existing_installation(self):
        self.lock['assets']['agent-plugin.zip']='0'*64
        with self.assertRaisesRegex(ValueError,'SHA-256'):self.install()
        self.assertFalse(self.plugin.exists()); self.assertEqual((self.destination/'data.json').read_bytes(),self.state)
    def test_unmanaged_plugin_is_preserved(self):
        self.plugin.mkdir(parents=True); (self.plugin/'custom.txt').write_text('keep')
        with self.assertRaisesRegex(ValueError,'unmanaged'):self.install()
        self.assertEqual((self.plugin/'custom.txt').read_text(),'keep')
    def test_old_plugin_must_be_disabled_and_moved_before_download(self):
        for name in ['noteweave','kb-types']:
            old=self.destination.parent/name; old.mkdir()
            with patch.object(installer,'download') as download, self.assertRaisesRegex(ValueError,'disable'):self.install()
            download.assert_not_called(); old.rmdir()
    def test_old_metadata_is_rejected(self):
        (self.vault/'.noteweave').mkdir()
        with self.assertRaisesRegex(ValueError,'migrate'):self.install()
    def test_custom_schema_and_vault_as_repository(self):
        (self.vault/'rules').mkdir(); (self.metadata/'schema.json').rename(self.vault/'rules/vocabulary.json')
        (self.metadata/'config.json').write_text(json.dumps({'version':1,'repository_root':'.','paths':{'schema':'rules/vocabulary.json'}}))
        self.install()
        self.assertTrue((self.vault/'.agents/plugins/noteweaver/plugin.json').is_file())
        self.assertFalse((self.root/'.agents').exists())
    def test_path_escape_and_symlinks_fail_before_installation(self):
        for path in ['../schema.json','/tmp/schema.json','a/../b','a//b',None]:
            (self.metadata/'config.json').write_text(json.dumps({'version':1,'paths':{'schema':path}}))
            with self.assertRaisesRegex(ValueError,'schema path'):self.install()
        (self.metadata/'config.json').write_text('{"version":1,"repository_root":".."}')
        (self.root/'.agents').symlink_to(self.vault,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'real directory'):self.install()
    def test_write_failure_rolls_back_all_completed_replacements(self):
        self.install(); (self.plugin/'plugin.json').write_text('previous user edit')
        (self.destination/'main.js').write_text('old binary')
        original=installer.os.replace; calls=0
        def fail_once(source,target):
            nonlocal calls
            calls+=1
            if calls==4:raise OSError('simulated disk failure')
            return original(source,target)
        with patch.object(installer.os,'replace',side_effect=fail_once), self.assertRaisesRegex(OSError,'disk failure'):self.install()
        self.assertEqual((self.plugin/'plugin.json').read_text(),'previous user edit')
        self.assertEqual((self.destination/'main.js').read_text(),'old binary')
        self.assertEqual((self.destination/'data.json').read_bytes(),self.state)
    def test_archive_traversal_and_duplicate_paths_are_rejected(self):
        for names in [['../escape'],['/escape'],['a','a']]:
            raw=io.BytesIO()
            with zipfile.ZipFile(raw,'w') as z:
                for name in names:z.writestr(name,b'x')
            with self.assertRaisesRegex(ValueError,'archive'):installer.unpack(raw.getvalue())
    def test_bundle_corruption_fails_inventory_validation(self):
        files=installer.unpack((ROOT/'dist/agent-plugin.zip').read_bytes())
        files['skills/noteweaver-query/SKILL.md']=b'changed'
        with self.assertRaisesRegex(ValueError,'checksum'):installer.validate_bundle(files,VERSION)
    def test_fallback_mode_materializes_same_skills_without_another_source_tree(self):
        self.install(mode='skills')
        self.assertEqual((self.root/'.agents/skills/noteweaver-query/SKILL.md').read_bytes(),(self.plugin/'skills/noteweaver-query/SKILL.md').read_bytes())
        with self.assertRaisesRegex(ValueError,'mode changed'):self.install()
    def test_bootstrap_installs_only_tools_and_requires_explicit_flag(self):
        (self.metadata/'config.json').unlink(); (self.metadata/'schema.json').unlink()
        with self.assertRaisesRegex(ValueError,'config required'):self.install()
        self.install(bootstrap=True)
        self.assertFalse((self.metadata/'config.json').exists())
        self.assertFalse((self.vault/'bank').exists())
        self.assertTrue((self.vault/'.agents/plugins/noteweaver/plugin.json').is_file())

if __name__=='__main__':unittest.main()

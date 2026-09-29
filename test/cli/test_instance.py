"""Exercise the shipped CLI on a synthetic vault with unrelated paths and names."""
import json,os,shutil,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class InstanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.vault=Path(self.tmp.name)/'research-notebook'
        shutil.copytree(ROOT/'example-vault',self.vault)
        self.config=self.vault/'.kb/config.json'
        data=json.loads(self.config.read_text());data.update(repository_root='.',vault_name='research-notebook')
        self.config.write_text(json.dumps(data))
        for args in [('init','-q'),('add','.'),('-c','user.name=test','-c','user.email=test@local','commit','-qm','synthetic baseline')]:
            subprocess.run(['git','-C',str(self.vault),*args],check=True,capture_output=True)
    def cli(self,*args):
        return subprocess.run(['python3',str(ROOT/'cli/kb'),'--root',str(self.vault),*args],capture_output=True,text=True)
    def test_standalone_instance_passes_without_a_system_directory(self):
        r=self.cli('check','--json');self.assertEqual(r.returncode,0,r.stderr+r.stdout)
        self.assertEqual(json.loads(r.stdout)['errors'],0)
        self.assertFalse((self.vault/'system').exists())
    def test_cli_uses_the_shared_frontmatter_validator(self):
        p=self.vault/'bank/entities/models/alpha-model.md'
        p.write_text(p.read_text().replace('license: mit','license: unavailable'))
        r=self.cli('check','--json');self.assertEqual(r.returncode,1,r.stderr)
        self.assertIn('fm-value',[f['code'] for f in json.loads(r.stdout)['findings']])
    def test_configured_bank_path(self):
        (self.vault/'bank').rename(self.vault/'notes')
        data=json.loads(self.config.read_text());data['paths']['bank']='notes';self.config.write_text(json.dumps(data))
        p=self.vault/'.kb/schema.json';schema=json.loads(p.read_text())
        schema['directories']={k.replace('bank/','notes/',1):v for k,v in schema['directories'].items()};p.write_text(json.dumps(schema))
        self.assertEqual(self.cli('schema').returncode,0)
        r=self.cli('check','--json');self.assertEqual(r.returncode,0,r.stderr+r.stdout)
    def test_competing_schema_is_rejected(self):
        p=self.vault/'.obsidian/kb-schema.json';p.parent.mkdir(exist_ok=True);p.write_text('{}')
        r=self.cli('check');self.assertEqual(r.returncode,2);self.assertIn('two schema',r.stderr)
    def test_generic_skill_context_uses_explicit_instance(self):
        r=subprocess.run(['python3',str(ROOT/'skills/kb-query/scripts/context.py'),'--vault',str(self.vault)],capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(json.loads(r.stdout)['config']['vault_name'],'research-notebook')
    def test_review_command_only_lists_open_decisions(self):
        review=self.vault/'.kb/review';review.mkdir(parents=True)
        for status in ['open','accepted']:(review/f'{status}.md').write_text(f'---\ntype: review\ntitle: Example {status}\nstatus: {status}\n---\n')
        r=self.cli('review');self.assertEqual(r.returncode,0,r.stderr);rows=json.loads(r.stdout)
        self.assertEqual([x['title'] for x in rows],['Example open'])
    def test_paths_cannot_escape_instance(self):
        data=json.loads(self.config.read_text());data['paths']['schema']='../schema.json';self.config.write_text(json.dumps(data))
        r=self.cli('info');self.assertEqual(r.returncode,2);self.assertIn('invalid instance path',r.stderr)
if __name__=='__main__':unittest.main()

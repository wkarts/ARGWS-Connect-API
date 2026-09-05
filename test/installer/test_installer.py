import base64
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('connect_installer',ROOT/'install-connect.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class InstallerTests(unittest.TestCase):
    def test_repository_restrictions(self):
        self.assertEqual(m.repository('https://github.com/wkarts/ARGWS-Connect-API.git'),'wkarts/ARGWS-Connect-API')
        for name in ['https://user:token@github.com/a/b','https://evil.test/a/b','a/b/../../etc','https://github.com/a/b?q=secret']:
            with self.subTest(name=name),self.assertRaises(m.InstallError):m.repository(name)

    def test_source_pins_commit_and_verifies_blob(self):
        src=m.GitHubSource('owner/repo');data=b'name: sample\n';sha=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        response={'type':'file','encoding':'base64','content':base64.b64encode(data).decode(),'sha':sha}
        with patch.object(src,'get',return_value=response) as request:
            self.assertEqual(src.file('deploy/develop/compose.yaml','f'*40),data.decode())
            self.assertIn('?ref='+'f'*40,request.call_args.args[0])
        response['sha']='0'*40
        with patch.object(src,'get',return_value=response),self.assertRaises(m.InstallError):src.file('compose.yaml','f'*40)

    def test_production_cannot_fallback_to_develop(self):
        source=m.GitHubSource('owner/repo')
        with self.assertRaises(m.InstallError):source.resolve('develop','production')
        with patch.object(source,'get',side_effect=m.InstallError('404')):
            with self.assertRaises(m.InstallError):source.resolve('latest','production')

    def test_release_is_resolved_to_immutable_sha(self):
        source=m.GitHubSource('owner/repo')
        with patch.object(source,'get',side_effect=[{'tag_name':'v2.3.4'},{'draft':False,'prerelease':False},{'sha':'a'*40}]):
            self.assertEqual(source.resolve('latest','production'),('a'*40,'2.3.4'))

    def test_new_secrets_are_coherent_and_fernet_key_valid(self):
        template='PASSWORD=CHANGE_ME_DB\nURL=postgres://user:CHANGE_ME_DB@db/name\nPLATFORM_FIELD_ENCRYPTION_KEY=CHANGE_ME_FIELD_ENCRYPTION_KEY\n'
        text,_=m.prepare_env(template,None,'develop',[]);values=m.env_values(text)
        self.assertIn(values['PASSWORD'],values['URL'])
        self.assertEqual(len(base64.urlsafe_b64decode(values['PLATFORM_FIELD_ENCRYPTION_KEY'])),32)
        self.assertNotIn('CHANGE_ME',text)

    def test_update_preserves_credential_domains_and_comments(self):
        existing='# saved\nPASSWORD=existing-$-secret\nDOMAIN=customer.example.test\nARGWS_CONNECT_API_IMAGE=ghcr.io/private/api:develop\n'
        text,_=m.prepare_env(existing,existing,'2.3.4',[])
        self.assertIn('PASSWORD=existing-$-secret',text)
        self.assertIn('# saved',text)
        self.assertIn('DOMAIN=customer.example.test',text)
        self.assertIn('ghcr.io/private/api:2.3.4',text)

    def test_missing_secret_is_not_generated_during_update(self):
        with self.assertRaises(m.InstallError):m.prepare_env('PASSWORD=CHANGE_ME_DB\n','NAME=test\n','develop',[])

    def test_no_duplicate_or_injected_env(self):
        with self.assertRaises(m.InstallError):m.env_values('X=one\nX=two\n')
        with self.assertRaises(m.InstallError):m.set_env('X=foo\n','X','bad\nVALUE=another')
        self.assertIn("X='a$b # c'",m.set_env('X=foo\n','X','a$b # c'))

    def test_shell_secrets_and_compose_overrides_are_not_inherited(self):
        with patch.dict(m.os.environ,{'GH_TOKEN':'github-secret','GITHUB_TOKEN':'secret','PASSWORD':'shell-override','COMPOSE_FILE':'evil.yaml'}):
            env=m.sanitized_env('PASSWORD=fromfile\n')
        self.assertNotIn('GH_TOKEN',env);self.assertNotIn('PASSWORD',env);self.assertNotIn('COMPOSE_FILE',env)

    def test_changed_data_paths_block_upgrade(self):
        old={'name':'project','services':{'db':{'image':'postgres:17','volumes':[{'source':'/data','target':'/var/lib/postgresql/data'}]}}}
        new=json.loads(json.dumps(old));new['services']['db']['volumes'][0]['source']='/empty'
        with self.assertRaises(m.InstallError):m.validate_plan(new,old,False,False)
        self.assertIsNone(m.validate_plan(old,old,False,False))

    def test_privileged_agent_requires_explicit_consent(self):
        config={'services':{'agent':{'image':'agent:v1','privileged':True}}}
        with self.assertRaises(m.InstallError):m.validate_plan(config,None,False,False)

    def test_symlink_and_root_directories_rejected(self):
        with self.assertRaises(m.InstallError):m.safe_directory('/')
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'actual';target.mkdir();link=Path(tmp)/'link';link.symlink_to(target)
            with self.assertRaises(m.InstallError):m.safe_directory(str(link/'stack'))

    def test_configuration_snapshot_preserves_volume_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'volumes').mkdir();(root/'volumes/data').write_text('customer-data')
            (root/'.env').write_text('SECRET=unchanged');(root/'compose.yaml').write_text('old-config')
            m.save_stack(root,'new-config','SECRET=unchanged',{'status':'PREPARED'})
            self.assertEqual((root/'volumes/data').read_text(),'customer-data')
            self.assertEqual((root/'.env').stat().st_mode & 0o777,0o600)
            self.assertEqual(next((root/'.connect-installer-backups').glob('*/compose.yaml')).read_text(),'old-config')

    def test_all_official_runtime_deployments_exist(self):
        for name,(filename,_,_,_) in m.CATALOG.items():
            with self.subTest(name=name):
                self.assertTrue((ROOT/'deploy'/name/filename).is_file())
                m.env_values((ROOT/'deploy'/name/'env.example').read_text())

    def test_manifests_checked_before_any_container_up(self):
        with patch.object(m,'command',side_effect=m.InstallError('unavailable')) as command:
            with self.assertRaises(m.InstallError):m.check_images({'services':{'api':{'image':'private/api:1'}}},{})
        self.assertEqual(command.call_args.args[0][:3],['docker','manifest','inspect'])

    def test_command_error_never_echoes_stderr_secret(self):
        response=m.subprocess.CompletedProcess(['docker'],1,stdout='',stderr='password=DO_NOT_EXPOSE')
        with patch.object(m.subprocess,'run',return_value=response):
            with self.assertRaises(m.InstallError) as exc:m.command(['docker','compose','config'])
        self.assertNotIn('DO_NOT_EXPOSE',str(exc.exception))


if __name__=='__main__':unittest.main()

"""CI only. Resolve real Compose including staged env_file and compare upgrade data paths."""
import importlib.util
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('connect_installer_ci',ROOT/'install-connect.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def main():
    with tempfile.TemporaryDirectory(prefix='connect-compose-test-') as temp:
        root=Path(temp)
        for name,(filename,channel,full,profiles) in m.CATALOG.items():
            compose=(ROOT/'deploy'/name/filename).read_text()
            template=(ROOT/'deploy'/name/'env.example').read_text()
            environment,_=m.prepare_env(template,None,'develop' if channel!='production' else '9.9.9',profiles)
            stage=root/(name+'-staged');stage.mkdir()
            target=root/(name+'-target')
            (stage/'compose.yaml').write_text(compose);(stage/'.env').write_text(environment)
            env=m.sanitized_env(environment)
            config=m.rendered(target,stage,env)
            m.validate_plan(config,None,full,True)
            # No stack existed when config evaluated its env_file. No secrets printed.
            assert not target.exists()
            target.mkdir();(target/'compose.yaml').write_text(compose);(target/'.env').write_text(environment)
            installed=m.rendered(target,target,env)
            m.validate_plan(config,installed,full,True)
            print(name+': staged env + preservation PASS ('+str(len(config['services']))+' services)')


if __name__=='__main__':main()

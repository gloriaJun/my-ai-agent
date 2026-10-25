#!/usr/bin/env python3
"""Behavioral tests for the host backup runner."""

import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
import datetime as dt
import signal
import fcntl


SCRIPT = pathlib.Path(__file__).with_name("oracle-maintenance.py")


class BackupBehavior(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.home = self.base / "home"
        self.state = self.base / "state"
        self.bin = self.base / "bin"
        self.remote = self.base / "remote"
        self.bin.mkdir()
        self.remote.mkdir()
        self.state.mkdir()
        self.create_source()
        self.make_tools()
        config = {
            "home": str(self.home), "state_dir": str(self.state),
            "remote": "fixture:oracle-backups", "rclone_config": str(self.base / "rclone.conf"),
            "grace_seconds": 0, "health_timeout_seconds": 1, "retention_days": 999999,
        }
        self.config = self.base / "config.json"
        self.config.write_text(json.dumps(config))
        (self.base / "rclone.conf").write_text("configured")
        self.environment = {**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ.get("PATH", ""),
                            "FIXTURE_HOME": str(self.home), "FIXTURE_REMOTE": str(self.remote),
                            "FIXTURE_STATE": str(self.state)}

    def create_source(self):
        ai = self.home / "my-ai-agent"
        hub = self.home / "my-assistant-hub"
        for relative in ["data/n8n", "data/nginx/config", "data/nginx/letsencrypt", "docker", "n8n/workflows", "scripts"]:
            (ai / relative).mkdir(parents=True, exist_ok=True)
        for relative in ["apps/ricetta/data", "apps/kw-hs-booking/backend/data", "packages"]:
            (hub / relative).mkdir(parents=True, exist_ok=True)
        for relative in [".env", "docker-compose.yml", "docker-compose-nginx.yml", "docker/n8n.Dockerfile", "scripts/oracle-maintenance.py"]:
            (ai / relative).write_text("settings")
        (ai / "data/n8n/n8nEventLog.log").write_text("private execution log")
        (ai / "data/nginx/config/logs").mkdir()
        (ai / "data/nginx/config/logs/access.log").write_text("private access log")
        (ai / "data/nginx/letsencrypt/live/example").mkdir(parents=True)
        (ai / "data/nginx/letsencrypt/archive/example").mkdir(parents=True)
        (ai / "data/nginx/letsencrypt/archive/example/fullchain1.pem").write_text("certificate")
        (ai / "data/nginx/letsencrypt/live/example/fullchain.pem").symlink_to("../../archive/example/fullchain1.pem")
        (hub / "apps/ricetta/.env").write_text("ricetta config")
        (hub / "apps/ricetta/.env.bak").write_text("obsolete credentials")
        (hub / "apps/kw-hs-booking/backend/.env").write_text("booking config")
        (hub / "apps/kw-hs-booking/backend/preferences.yaml").write_text("prefs")
        (hub / "package.json").write_text("{}")
        for db in [ai / "data/n8n/database.sqlite", ai / "data/nginx/config/database.sqlite",
                   hub / "apps/ricetta/data/ricetta.db", hub / "apps/kw-hs-booking/backend/data/reservations.db"]:
            conn = sqlite3.connect(db)
            conn.execute("CREATE TABLE sample (value TEXT)")
            conn.execute("INSERT INTO sample VALUES ('recovery data')")
            conn.commit()
            conn.close()

    def make_tools(self):
        self.write_tool("docker", '''#!/usr/bin/env python3
import os,sys,json,pathlib,time
root=pathlib.Path(os.environ['FIXTURE_HOME']); state=pathlib.Path(os.environ['FIXTURE_STATE'])
args=sys.argv[1:]
with (state/'calls').open('a') as f:f.write('docker '+json.dumps(args)+'\\n')
names=['n8n','nginx-proxy','ricetta','kw-booking','openclaw','news-digest','tworld-gift']
mounts={
 'n8n':[root/'my-ai-agent/data/n8n'],
 'nginx-proxy':[root/'my-ai-agent/data/nginx/config',root/'my-ai-agent/data/nginx/letsencrypt'],
 'ricetta':[root/'my-assistant-hub/apps/ricetta/data'],
 'kw-booking':[root/'my-assistant-hub/apps/kw-hs-booking/backend/data',root/'my-assistant-hub/apps/kw-hs-booking/backend/preferences.yaml'],
}
stopped=set(json.loads((state/'stopped.json').read_text())) if (state/'stopped.json').exists() else set()
if args[0]=='ps':print('\\n'.join(names));sys.exit(0)
if args[0]=='inspect':
 out=[]
 for name in args[1:]:
  health='unhealthy' if name=='ricetta' and (state/'degrade-after-publish').exists() and (state/'published').exists() else 'healthy'
  out.append({'Name':'/'+name,'State':{'Running':name not in stopped,'Health':{'Status':health}},
    'Mounts':[{'Type':'bind','Source':str(p)} for p in mounts.get(name,[])],
    'Config':{'Image':'fixture/'+name,'Env':[]}})
 print(json.dumps(out));sys.exit(0)
if args[0]=='network' and args[1]=='inspect':print(json.dumps([{'Name':'proxy-net'}]));sys.exit(0)
if args[0]=='stop':
 stopped.update(x for x in args[1:] if x in names)
 (state/'stopped.json').write_text(json.dumps(sorted(stopped)))
 if (state/'pause-after-stop').exists():time.sleep(5)
 sys.exit(0)
if args[0]=='start':
 if (state/'fail-start').exists():sys.exit(3)
 stopped.difference_update(args[1:]);(state/'stopped.json').write_text(json.dumps(sorted(stopped)));sys.exit(0)
if args[:2]==['image','inspect']:
 print(json.dumps([{'Id':'sha256:'+'a'*64,'RepoTags':[name+':latest'],
                    'RepoDigests':[name+'@sha256:'+'b'*64]} for name in args[2:]]));sys.exit(0)
if args[:2]==['buildx','prune'] or args[:2]==['image','prune']:
 if (state/'fail-cleanup').exists():sys.exit(3)
 sys.exit(0)
sys.exit(4)
''')
        self.write_tool("rclone", '''#!/usr/bin/env python3
import os,sys,pathlib,shutil,json,hashlib,time
args=sys.argv[1:]; root=pathlib.Path(os.environ['FIXTURE_REMOTE']); state=pathlib.Path(os.environ['FIXTURE_STATE'])
with (state/'calls').open('a') as f:f.write('rclone '+json.dumps(args)+'\\n')
args=[a for a in args if a!='--config' and a!=os.environ.get('RCLONE_CONFIG','')]
if 'copyto' in args:
 if (state/'fail-upload').exists():sys.exit(3)
 source=pathlib.Path(args[args.index('copyto')+1]);dest=root/pathlib.Path(args[args.index('copyto')+2]).name
 shutil.copyfile(source,dest)
 if (state/'pause-upload').exists():
  (state/'upload-started').touch()
  time.sleep(5)
 if (state/'bad-remote-hash').exists():dest.write_text('corrupted')
 sys.exit(0)
if 'moveto' in args:
 source=root/pathlib.Path(args[args.index('moveto')+1]).name
 dest=root/pathlib.Path(args[args.index('moveto')+2]).name
 source.rename(dest)
 if (state/'degrade-after-publish').exists():(state/'published').touch()
 if (state/'bad-final-hash').exists():dest.write_text('corrupted after rename')
 sys.exit(0)
if 'lsf' in args:
 if (state/'missing-remote-dir').exists() and 'fixture:oracle-backups' in args:sys.exit(3)
 print('\\n'.join(p.name for p in root.iterdir()));sys.exit(0)
if 'md5sum' in args:
 p=root/pathlib.Path(args[args.index('md5sum')+1]).name
 print(hashlib.md5(p.read_bytes()).hexdigest()+'  '+p.name);sys.exit(0)
if 'size' in args:
 p=root/pathlib.Path(args[args.index('size')+1]).name
 size=p.stat().st_size+1 if (state/'bad-remote-size').exists() else p.stat().st_size
 print(json.dumps({'count':1,'bytes':size,'sizeless':0}));sys.exit(0)
if 'deletefile' in args:
 (root/pathlib.Path(args[args.index('deletefile')+1]).name).unlink();sys.exit(0)
sys.exit(4)
''')
        self.write_tool("journalctl", '''#!/usr/bin/env python3
import os,sys,pathlib,json
with (pathlib.Path(os.environ['FIXTURE_STATE'])/'calls').open('a') as f:f.write('journalctl '+json.dumps(sys.argv[1:])+'\\n')
''')
        self.write_tool("git", '''#!/usr/bin/env python3
import sys
print('fixture-commit')
''')
        self.write_tool("sitecustomize.py", '''import os,pathlib,sqlite3,time
old_connect=sqlite3.connect
def guarded_connect(database,*args,**kwargs):
 if (pathlib.Path(os.environ['FIXTURE_STATE'])/'pause-verify').exists() and '/work/' in str(database):
  (pathlib.Path(os.environ['FIXTURE_STATE'])/'verify-started').touch()
  time.sleep(5)
 return old_connect(database,*args,**kwargs)
sqlite3.connect=guarded_connect
''')

    def write_tool(self, name, code):
        path = self.bin / name
        path.write_text(code)
        path.chmod(0o755)

    def request(self):
        requests = self.state / "requests"
        requests.mkdir(exist_ok=True)
        (requests / "start.json").write_text(json.dumps({"request_id": str(uuid.uuid4()), "requested_at": dt.datetime.now(dt.timezone.utc).isoformat()}))

    def execute(self, action="run"):
        return subprocess.run([sys.executable, str(SCRIPT), action, "--config", str(self.config)],
                              env=self.environment, text=True, capture_output=True)

    def latest(self):
        return json.loads((self.state / "status/latest.json").read_text())

    def calls(self):
        p=self.state/'calls'
        return p.read_text() if p.exists() else ''

    def test_valid_backup_excludes_logs_and_checks_sqlite(self):
        self.request()
        result=self.execute()
        self.assertEqual(result.returncode,0,result.stderr)
        status=self.latest()
        self.assertEqual(status['state'],'success')
        self.assertEqual(status['backup']['sqlite_count'],4)
        self.assertTrue(status['backup']['verified'])
        self.assertEqual(len(list(self.remote.glob('oracle-services-*.tar.gz'))),1)
        import tarfile
        with tarfile.open(next(self.remote.glob('oracle-services-*.tar.gz')),'r:gz') as tf:
            names=tf.getnames()
            self.assertIn('my-ai-agent/data/n8n/database.sqlite',names)
            self.assertIn('my-assistant-hub/apps/ricetta/.env',names)
            self.assertNotIn('my-ai-agent/data/n8n/n8nEventLog.log',names)
            self.assertNotIn('my-assistant-hub/apps/ricetta/.env.bak',names)
            cert=tf.getmember('my-ai-agent/data/nginx/letsencrypt/live/example/fullchain.pem')
            self.assertTrue(cert.issym())
            self.assertEqual(cert.linkname,'../../archive/example/fullchain1.pem')
            self.assertFalse(any('/logs/' in name or name.endswith('.log') for name in names))
            metadata=json.load(tf.extractfile('recovery/metadata.json'))
            self.assertEqual(len(metadata['images']),4)
            self.assertTrue(any(image['RepoDigests'] for image in metadata['images']))

    def test_missing_drive_folder_fails_before_service_downtime(self):
        self.request()
        (self.state/'missing-remote-dir').touch()
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('docker ["stop"',self.calls())
        self.assertEqual(self.latest()['state'],'failed')

    def test_upload_failure_preserves_previous_backup_and_recovers_services(self):
        self.request()
        old=self.remote/'oracle-services-20261001T000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tar.gz'
        old.write_text('old backup')
        (self.state/'fail-upload').touch()
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.latest()['state'],'failed')
        self.assertEqual(len(list(self.remote.iterdir())),1)
        self.assertEqual(json.loads((self.state/'stopped.json').read_text()),[])
        self.assertFalse((self.state/'restart.json').exists())
        self.assertEqual([p.name for p in self.remote.iterdir()],[old.name])
        self.assertFalse(list((self.state/'work').glob('oracle-services-*.tar.gz')))
        self.request()
        again=self.execute()
        self.assertNotEqual(again.returncode,0)
        self.assertFalse(list((self.state/'work').glob('oracle-services-*.tar.gz')))

    def test_hash_mismatch_keeps_previous_and_does_not_delete_unrelated(self):
        self.request()
        old=self.remote/'oracle-services-20261001T000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tar.gz'
        old.write_text('old backup')
        unrelated=self.remote/'family-photo.jpg';unrelated.write_text('photo')
        (self.state/'bad-remote-hash').touch()
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertTrue(old.exists())
        self.assertTrue(unrelated.exists())
        self.assertEqual({p.name for p in self.remote.iterdir()},{old.name,unrelated.name})

    def test_size_mismatch_preserves_previous_backup(self):
        self.request()
        old=self.remote/'oracle-services-20261001T000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tar.gz'
        old.write_text('old backup')
        (self.state/'bad-remote-size').touch()
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertTrue(old.exists())
        self.assertEqual([p.name for p in self.remote.iterdir()],[old.name])

    def test_post_publish_hash_failure_removes_only_unverified_new_file(self):
        self.request()
        old=self.remote/'oracle-services-20261001T000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tar.gz'
        old.write_text('old backup')
        unrelated=self.remote/'family-photo.jpg';unrelated.write_text('photo')
        (self.state/'bad-final-hash').touch()
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertEqual({p.name for p in self.remote.iterdir()},{old.name,unrelated.name})
        self.assertIn('moveto',self.calls())

    def test_service_unhealthy_after_upload_reports_partial_with_verified_backup(self):
        self.request()
        (self.state/'degrade-after-publish').touch()
        result=self.execute()
        self.assertEqual(result.returncode,0,result.stderr)
        status=self.latest()
        self.assertEqual(status['state'],'partial')
        self.assertTrue(status['backup']['verified'])
        self.assertTrue(any(s['name']=='ricetta' and s['health']=='unhealthy' for s in status['services']))

    def test_corrupt_database_does_not_delete_previous_backup(self):
        self.request()
        old=self.remote/'oracle-services-20261001T000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tar.gz'
        old.write_text('old backup')
        db=self.home/'my-assistant-hub/apps/ricetta/data/ricetta.db'
        db.write_bytes(b'SQLite format 3\x00' + b'corrupted payload')
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(json.loads((self.state/'stopped.json').read_text()),[])
        self.assertFalse((self.state/'restart.json').exists())
        self.assertTrue(old.exists())
        self.assertNotIn('copyto',self.calls())

    def test_success_prunes_only_previous_owned_files(self):
        self.request()
        old=self.remote/'oracle-services-20261001T000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tar.gz';old.write_text('old')
        unrelated=self.remote/'family-photo.jpg';unrelated.write_text('photo')
        result=self.execute()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse(old.exists())
        self.assertTrue(unrelated.exists())
        self.assertEqual(len(list(self.remote.glob('oracle-services-*.tar.gz'))),1)
        self.assertFalse(list((self.state/'work').glob('*.tar.gz')))

    def test_monthly_cleanup_failure_is_partial_then_retries_next_week(self):
        self.request();(self.state/'fail-cleanup').touch()
        first=self.execute()
        self.assertEqual(first.returncode,0,first.stderr)
        self.assertEqual(self.latest()['state'],'partial')
        self.assertEqual(self.latest()['backup']['state'],'success')
        self.assertFalse((self.state/'monthly.json').exists())
        (self.state/'fail-cleanup').unlink()
        self.request();second=self.execute()
        self.assertEqual(second.returncode,0,second.stderr)
        self.assertEqual(self.latest()['state'],'success')
        self.assertTrue((self.state/'monthly.json').exists())
        self.assertEqual(self.calls().count('buildx'),2)
        self.request();third=self.execute()
        self.assertEqual(third.returncode,0,third.stderr)
        self.assertEqual(self.calls().count('buildx'),2)

    def test_recover_resumes_stopped_services_from_durable_marker(self):
        (self.state/'restart.json').write_text(json.dumps({'names':['n8n','ricetta']}))
        (self.state/'stopped.json').write_text(json.dumps(['n8n','ricetta']))
        result=self.execute('recover')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse((self.state/'restart.json').exists())
        self.assertEqual(json.loads((self.state/'stopped.json').read_text()),[])

    def test_invalid_request_consumed_without_stopping_services(self):
        (self.state/'requests').mkdir()
        (self.state/'requests/start.json').write_text('{invalid')
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertFalse((self.state/'requests/start.json').exists())
        self.assertNotIn('docker ["stop"',self.calls())

    def test_duplicate_request_during_active_run_is_consumed_without_stopping_services(self):
        self.request()
        (self.state/'status').mkdir()
        previous={'state':'running','run_id':'existing-run'}
        (self.state/'status/latest.json').write_text(json.dumps(previous))
        with (self.state/'run.lock').open('a') as lock:
            fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            result=self.execute()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse((self.state/'requests/start.json').exists())
        self.assertEqual(self.latest(),previous)
        self.assertNotIn('docker ["stop"',self.calls())

    def test_failed_restart_keeps_durable_marker_until_recovery_succeeds(self):
        self.request()
        (self.state/'fail-start').touch()
        result=self.execute()
        self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.state/'restart.json').exists())
        self.assertEqual(self.latest()['state'],'failed')
        self.assertNotIn('copyto',self.calls())
        (self.state/'fail-start').unlink()
        recovered=self.execute('recover')
        self.assertEqual(recovered.returncode,0,recovered.stderr)
        self.assertFalse((self.state/'restart.json').exists())
        self.assertEqual(json.loads((self.state/'stopped.json').read_text()),[])

    def test_forced_termination_during_stop_recovers_on_next_boot(self):
        self.request()
        (self.state/'pause-after-stop').touch()
        process=subprocess.Popen([sys.executable,str(SCRIPT),'run','--config',str(self.config)],
                                 env=self.environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            deadline=time.monotonic()+5
            while not (self.state/'stopped.json').exists() and time.monotonic()<deadline:
                time.sleep(0.02)
            self.assertTrue((self.state/'stopped.json').exists())
            process.send_signal(signal.SIGKILL)
            process.communicate(timeout=10)
            self.assertTrue((self.state/'restart.json').exists())
            recovered=self.execute('recover')
            self.assertEqual(recovered.returncode,0,recovered.stderr)
            self.assertEqual(json.loads((self.state/'stopped.json').read_text()),[])
            self.assertFalse((self.state/'restart.json').exists())
            self.assertEqual(self.latest()['state'],'failed')
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_boot_recovery_removes_orphan_archive_after_forced_termination(self):
        self.request()
        (self.state/'pause-upload').touch()
        old=self.remote/'oracle-services-20261001T000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tar.gz'
        old.write_text('prior verified backup')
        process=subprocess.Popen([sys.executable,str(SCRIPT),'run','--config',str(self.config)],
                                 env=self.environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            deadline=time.monotonic()+8
            while not (self.state/'upload-started').exists() and time.monotonic()<deadline:
                time.sleep(0.02)
            self.assertTrue((self.state/'upload-started').exists())
            self.assertTrue(list((self.state/'work').glob('oracle-services-*.tar.gz')))
            process.send_signal(signal.SIGKILL)
            process.communicate(timeout=10)
            recovered=self.execute('recover')
            self.assertEqual(recovered.returncode,0,recovered.stderr)
            self.assertFalse(list((self.state/'work').glob('oracle-services-*.tar.gz')))
            self.assertTrue(old.exists())
            self.assertEqual(self.latest()['state'],'failed')
            self.assertGreaterEqual(len(self.latest()['services']),4)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_cleanup_removes_only_old_rotated_n8n_event_logs(self):
        import importlib.util
        from unittest import mock

        spec = importlib.util.spec_from_file_location('maintenance_log_test', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        runner = module.Maintenance(module.load_settings(self.config))
        runner.settings['retention_days'] = 7
        directory = self.home/'my-ai-agent/data/n8n'
        old = directory/'n8nEventLog-1.log'
        recent = directory/'n8nEventLog-2.log'
        active = directory/'n8nEventLog.log'
        for item in [old, recent, active]:
            item.write_text('fixture log')
        for item in [old, active]:
            os.utime(item, (time.time()-10*86400, time.time()-10*86400))
        original = pathlib.Path.rglob

        def fixture_logs(directory, pattern):
            if directory == pathlib.Path('/var/log'):
                return iter(())
            return original(directory, pattern)

        with mock.patch.dict(os.environ, self.environment), mock.patch.object(pathlib.Path, 'rglob', fixture_logs):
            runner.monthly_cleanup()
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(active.exists())

    def test_boot_recovery_removes_private_database_snapshot_after_forced_termination(self):
        self.request()
        (self.state/'pause-verify').touch()
        work=self.state/'work';work.mkdir()
        unrelated=work/'keep-this-directory';unrelated.mkdir()
        environment={**self.environment,'PYTHONPATH':str(self.bin)}
        process=subprocess.Popen([sys.executable,str(SCRIPT),'run','--config',str(self.config)],
                                 env=environment,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            deadline=time.monotonic()+8
            while not (self.state/'verify-started').exists() and time.monotonic()<deadline:
                time.sleep(0.02)
            self.assertTrue((self.state/'verify-started').exists())
            self.assertTrue(any(p.is_dir() and p != unrelated for p in work.iterdir()))
            process.send_signal(signal.SIGKILL)
            process.communicate(timeout=10)
            (self.state/'pause-verify').unlink()
            recovered=self.execute('recover')
            self.assertEqual(recovered.returncode,0,recovered.stderr)
            self.assertEqual([p.name for p in work.iterdir()],[unrelated.name])
            self.assertEqual(self.latest()['state'],'failed')
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()


if __name__ == '__main__':
    unittest.main()

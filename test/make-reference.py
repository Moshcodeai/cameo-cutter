"""Generate the reference command stream with the original Python driver (dry run).

usage: python3 -I make-reference.py <repo> <job.json> <out.bin>
job.json: {"hardware": "Silhouette_Cameo5", "paths": [...mm...], "settings": {...}}
"""
import io
import json
import sys

repo, job_path, out_path = sys.argv[1:4]
sys.path.insert(0, repo)

from silhouette.Graphtec import SilhouetteCameo  # noqa: E402

job = json.load(open(job_path))
s = job["settings"]
buf = io.BytesIO()


class Keep(io.BytesIO):
    def close(self):  # called by us, then again by the finaliser: copy once
        if not self.closed and not buf.getvalue():
            buf.write(self.getvalue())
        super().close()


dev = SilhouetteCameo(log=sys.stderr, cmdfile=Keep(), dry_run=True,
                      force_hardware=job["hardware"])
tool = s["tool"]
dev.setup(media=300, pen=(tool == "pen"), toolholder=s.get("toolholder", 1),
          cuttingmat=s["mat"], sharpencorners=False, autoblade=(tool == "autoblade"),
          depth=s.get("depth"), sw_clipping=True, bladediameter=0.9,
          pressure=s["pressure"], speed=s["speed"])
dev.plot(pathlist=[[tuple(pt) for pt in p] for p in job["paths"]],
         mediawidth=job["mediaWidth"], mediaheight=job["mediaHeight"],
         offset=tuple(job.get("offset", (0, 0))), endposition="below",
         end_paper_offset=0)
dev.commands.close()
dev.commands = None
open(out_path, "wb").write(buf.getvalue())

# Sample footage

Videos are not committed. Generate the synthetic dev clip (with ground-truth labels and zones):

```bash
uv run ds-vision synth --out samples --seconds 900   # samples/dining-room.{mp4,labels.csv,zones.json}
```

Real footage recorded with `ds-vision record` for labelling stays on the outlet's machine (DPDP: get consent /
display notice, delete after use). Label CSV format: `table_id,start_s,end_s,state` (state: occupied | vacant).

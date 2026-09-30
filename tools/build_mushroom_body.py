"""Extract the real mushroom body input wiring from the FlyWire connectome (v783).

Inputs (not redistributed here; fetch with tools/fetch_sources.sh):
  sources/flywire_annotations/supplemental_files/Supplemental_file1_neuron_annotations.tsv
      FlyWire cell annotations (Schlegel et al. 2024, Nature)
  sources/Drosophila_brain_model/Connectivity_783.parquet
      FlyWire v783 synaptic connectivity as packaged by Shiu et al. 2024 (Nature)

Output: data/mushroom_body.json
  Every antennal-lobe projection neuron (ALPN) -> Kenyon cell (KC) connection with at least
  MIN_SYN synapses, plus cell types, sides and soma positions (micrometres) for drawing.
"""
import json, sys
from pathlib import Path
import numpy as np
import pandas as pd

MIN_SYN = 5  # the usual FlyWire threshold for a reliable connection
root = Path(sys.argv[1] if len(sys.argv) > 1 else 'sources')
out = Path(sys.argv[2] if len(sys.argv) > 2 else 'data/mushroom_body.json')

ann = pd.read_csv(root / 'flywire_annotations/supplemental_files/Supplemental_file1_neuron_annotations.tsv', sep='\t', low_memory=False)
con = pd.read_parquet(root / 'Drosophila_brain_model/Connectivity_783.parquet', columns=['Presynaptic_ID', 'Postsynaptic_ID', 'Connectivity'])

kcs = ann[ann.cell_class == 'Kenyon_Cell'].copy()
pns = ann[ann.cell_class == 'ALPN'].copy()
e = con[con.Presynaptic_ID.isin(set(pns.root_id)) & con.Postsynaptic_ID.isin(set(kcs.root_id))]
e = e.groupby(['Presynaptic_ID', 'Postsynaptic_ID'], as_index=False).Connectivity.sum()
e = e[e.Connectivity >= MIN_SYN]

# keep only PNs that actually reach a KC; keep every KC (some listen to other senses and stay silent here)
pns = pns[pns.root_id.isin(set(e.Presynaptic_ID))]
pns = pns.sort_values(['side', 'cell_type', 'root_id']).reset_index(drop=True)
kcs = kcs.sort_values(['side', 'cell_type', 'root_id']).reset_index(drop=True)
pidx = {r: i for i, r in enumerate(pns.root_id)}
kidx = {r: i for i, r in enumerate(kcs.root_id)}

claws = [[] for _ in range(len(kcs))]
for pre, post, n in e[['Presynaptic_ID', 'Postsynaptic_ID', 'Connectivity']].itertuples(index=False):
    claws[kidx[post]].append((pidx[pre], int(n)))
start, lst, syn = [0], [], []
for c in claws:
    c.sort()
    lst += [p for p, _ in c]; syn += [n for _, n in c]
    start.append(len(lst))

def um(df, pre):
    # FlyWire coordinates are 4 x 4 x 40 nm voxels
    x = df[pre + 'x'].astype(float) * 0.004; y = df[pre + 'y'].astype(float) * 0.004; z = df[pre + 'z'].astype(float) * 0.04
    return np.round(np.stack([x, y, z], 1), 1).reshape(-1).tolist()

def soma(df):
    s = df[['soma_x', 'soma_y', 'soma_z']].copy()
    for a, b in [('soma_x', 'pos_x'), ('soma_y', 'pos_y'), ('soma_z', 'pos_z')]:
        s[a] = pd.to_numeric(s[a], errors='coerce').fillna(df[b])
    s.columns = ['x', 'y', 'z']
    return um(s, '')

kc_types = sorted(kcs.cell_type.fillna('KC').unique())
pn_types = sorted(pns.cell_type.fillna('?').unique())
data = {
    'source': 'FlyWire connectome v783 (Dorkenwald et al. 2024; Schlegel et al. 2024), connectivity as packaged by Shiu et al. 2024',
    'minSynapses': MIN_SYN,
    'pn': {
        'n': len(pns), 'ids': [str(r) for r in pns.root_id], 'side': ''.join('L' if s == 'left' else 'R' for s in pns.side),
        'types': pn_types, 'type': [pn_types.index(t) for t in pns.cell_type.fillna('?')],
        'sub': ''.join('u' if s == 'uniglomerular' else 'm' for s in pns.cell_sub_class.fillna('m')),
        'soma': soma(pns),
    },
    'kc': {
        'n': len(kcs), 'ids': [str(r) for r in kcs.root_id], 'side': ''.join('L' if s == 'left' else 'R' for s in kcs.side),
        'types': kc_types, 'type': [kc_types.index(t) for t in kcs.cell_type.fillna('KC')],
        'soma': soma(kcs),
        'start': start, 'claws': lst, 'synapses': syn,
    },
}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(data, separators=(',', ':')))
deg = np.diff(start)
print(f'{len(pns)} PNs, {len(kcs)} KCs ({(deg > 0).sum()} with PN input), {len(lst)} claws, mean {deg[deg > 0].mean():.2f} claws per KC; {out} {out.stat().st_size // 1024} KB')

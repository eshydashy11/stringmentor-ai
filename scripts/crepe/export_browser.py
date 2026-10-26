"""Export verified FP32 models for a separate local browser feasibility test."""
from pathlib import Path
import hashlib,json,gzip
import numpy as np
import torch,torchcrepe
import onnx
from infer import aligned_frames,local_average_hz
from verify_models import MODELS

torch.set_num_threads(1)
torch.set_num_interop_threads(1)
root=Path('work/crepe/run'); output=Path('work/crepe/browser'); output.mkdir(exist_ok=True)
manifest=json.loads((root/'manifest.json').read_text())
choices=[('sustain-36',10),('sustain-43',10),('sustain-50',10),('sustain-57',10),('arpeggio-0.125-clean',10),('arpeggio-0.125-weak-fundamental',20),('arpeggio-0.125-resonance',30),('true-octaves',20)]
frames=[]
for name,index in choices:
 case=next(c for c in manifest['cases'] if c['id']==name)
 data=(root/case['pcmFile']).read_bytes(); assert hashlib.sha256(data).hexdigest()==case['pcmSha256']
 frame,_=aligned_frames(np.frombuffer(data,dtype='<f4'),[case['centres'][index]])
 frames.append(frame[0])
frames=np.stack(frames); models=[]
for capacity in ['tiny','full']:
 weights=Path(torchcrepe.__file__).parent/'assets'/f'{capacity}.pth'
 assert hashlib.sha256(weights.read_bytes()).hexdigest()==MODELS[capacity]['pth']
 torchcrepe.load.model('cpu',capacity)
 model=torchcrepe.infer.model
 path=output/f'{capacity}.onnx'
 with torch.inference_mode():
  expected=np.concatenate([model(torch.from_numpy(f[None])).numpy() for f in frames])
  torch.onnx.export(model,torch.from_numpy(frames[:1]),str(path),input_names=['frames'],output_names=['activation'],dynamic_axes={'frames':{0:'batch'},'activation':{0:'batch'}},opset_version=17,dynamo=False)
 onnx.checker.check_model(str(path))
 data=path.read_bytes()
 models.append({'capacity':capacity,'bytes':len(data),'gzipBytes':len(gzip.compress(data,mtime=0)),'sha256':hashlib.sha256(data).hexdigest(),'opset':17,'parameters':sum(p.numel() for p in model.parameters()),'referenceActivations':expected.tolist(),'referencePitch':local_average_hz(expected)})
 print(capacity,len(data),'bytes',flush=True)
(output/'fixtures.json').write_text(json.dumps({'manifestSha256':hashlib.sha256((root/'manifest.json').read_bytes()).hexdigest(),'choices':choices,'frames':frames.tolist(),'models':models},allow_nan=False))

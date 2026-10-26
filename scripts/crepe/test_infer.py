"""Offline preprocessing/decoding tests; no model download needed."""
import unittest
import numpy as np
from infer import aligned_frames,local_average_hz

class AlignmentTests(unittest.TestCase):
    def test_sample_centres_and_normalization(self):
        samples=np.sin(np.arange(44100,dtype=np.float32)*2*np.pi*146.832/22050)
        centres=list(range(2048,len(samples)-2048,512))
        frames,error=aligned_frames(samples,centres)
        self.assertEqual(frames.shape,(len(centres),1024))
        self.assertLessEqual(error,1/32000+1e-12)
        self.assertLess(float(np.abs(frames.mean(axis=1)).max()),1e-6)
        self.assertLess(float(np.abs(frames.std(axis=1)-1).max()),1e-6)
    def test_silence_stays_finite(self):
        frames,_=aligned_frames(np.zeros(22050,dtype=np.float32),[2048])
        self.assertTrue(np.all(frames==0))
    def test_decoder_matches_official_formula_at_edges_and_interior(self):
        rng=np.random.default_rng(2701)
        rows=rng.uniform(.001,.1,(3,360)).astype(np.float32)
        for row,peak in zip(rows,[0,170,359]):row[peak]=1
        for row,actual in zip(rows,local_average_hz(rows)):
            centre=int(np.argmax(row));start=max(0,centre-4);end=min(360,centre+5)
            mapping=np.linspace(0,7180,360)+1997.3794084376191
            cents=np.sum(row[start:end]*mapping[start:end])/np.sum(row[start:end])
            expected=10*2**(cents/1200)
            self.assertAlmostEqual(actual,expected,delta=0.001)
        self.assertEqual(local_average_hz(rows),local_average_hz(rows))
if __name__=='__main__':unittest.main()

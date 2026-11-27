"""Render Chinu's three original instrumental radio arrangements."""
import argparse
from pathlib import Path
import subprocess
import tempfile
import wave
import numpy as np

RATE = 32000
CHORDS = {
    "D": (50, 57, 62, 66, 69), "Bm": (47, 54, 59, 62, 66),
    "G": (43, 55, 59, 62, 67), "A": (45, 57, 61, 64, 69),
    "Am": (45, 57, 60, 64, 69), "F": (41, 53, 57, 60, 65),
    "C": (48, 55, 60, 64, 67), "G7": (43, 53, 59, 62, 67),
    "Em": (40, 52, 55, 59, 64), "B7": (47, 54, 57, 63, 66),
}
TRACKS = [
    ("pangong-at-dusk", 74, 4, "D Bm G A D G Bm A D Bm G A Em G A D",
     [74, 76, 81, 78, 76, 74, 71, 74, 71, 74, 79, 81, 76, 73, 71, 69], "keys"),
    ("a-road-for-two", 92, 4, "Am F C G7 Am F Em G7 Am F C G7 F C G7 Am",
     [72, 76, 79, 76, 77, 76, 72, 69, 67, 72, 76, 79, 74, 71, 69, 67], "pluck"),
    ("snowlight-waltz", 84, 3, "Em B7 Em G C G Am B7 Em C G D C Am B7 Em",
     [76, 79, 83, 78, 75, 78, 76, 72, 71, 74, 79, 74, 76, 72, 67, 71], "piano"),
]

def render(track, output, ffmpeg):
    name, tempo, beats, harmony, motif, lead = track
    chords = harmony.split()
    beat = 60 / tempo
    audio = np.zeros((int((len(chords) * beats * beat + 2.2) * RATE), 2), dtype=np.float32)

    def note(start, length, midi, gain, tone, pan):
        i = int(start * RATE)
        n = min(len(audio)-i, int(length * RATE))
        if n <= 0:
            return
        t = np.arange(n)/RATE
        phase = 2*np.pi*440*2**((midi-69)/12)*t
        if tone == "pad":
            y = (.52*np.sin(phase)+.28*np.sin(phase*1.003)+.2*np.sin(2*phase))
            env = np.minimum(t/.30, 1)*np.minimum((length-t)/.46, 1)
        else:
            harmonic = .38 if tone == "pluck" else .22
            y = np.sin(phase)+harmonic*np.sin(phase*2.002)+.12*np.sin(phase*3.004)
            decay = 3.8 if tone == "pluck" else 1.8 if tone == "piano" else 2.4
            env = np.minimum(1,t/.012)*np.exp(-decay*t)*np.minimum((length-t)/.16,1)
        sig = y*np.maximum(0,env)*gain
        audio[i:i+n,0] += sig * ((1-pan)/2)**.5
        audio[i:i+n,1] += sig * ((1+pan)/2)**.5

    for bar, chord in enumerate(chords):
        start=bar*beats*beat
        voicing=CHORDS[chord]
        note(start,beats*beat,voicing[0],.16,"keys",0)
        for index, pitch in enumerate(voicing[1:]):
            note(start+(index%2)*.09, beats*beat+.38, pitch,.038,"pad",(-1)**index*.50)
        for step in range(beats*2):
            pitch=voicing[1+(step if step<4 else 7-step)%4]
            note(start+step*beat*.5,beat*1.1,pitch,.10,"pluck" if lead=="pluck" else "piano",(-1)**step*.32)
        if bar not in (0, 1, len(chords)-1):
            for p, when in enumerate((.18,1.1,2.35)):
                pitch=motif[((bar-2)*2+p)%len(motif)]
                if p==2 and bar%2==0:
                    pitch=voicing[-1]+(12 if pitch>=voicing[-1]+4 else 0)
                note(start+when*beat,beat*1.65,pitch,.195,lead,.11)
        if bar == len(chords)-1:
            note(start+beat*.37, beats*beat, voicing[2]+12,.19,lead,.05)

    delay=int(.147*RATE)
    audio[delay:,1] += audio[:-delay,0]*.115
    audio[delay:,0] += audio[:-delay,1]*.095
    audio[:int(.13*RATE)] *= np.linspace(0,1,int(.13*RATE))[:,None]
    audio[-RATE:] *= np.linspace(1,0,RATE)[:,None]
    audio *= .84/max(.001,np.abs(audio).max())
    with tempfile.TemporaryDirectory() as folder:
        wav=Path(folder)/"track.wav"
        with wave.open(str(wav),"wb") as f:
            f.setparams((2,2,RATE,0,"NONE","not compressed"))
            f.writeframes((audio*32767).astype("<i2").tobytes())
        subprocess.run([ffmpeg,"-v","error","-y","-i",str(wav),"-c:a","libvorbis","-q:a","4",str(output/(name+".ogg"))],check=True)

if __name__=="__main__":
    args=argparse.ArgumentParser()
    args.add_argument("output",type=Path)
    args.add_argument("--ffmpeg",default="ffmpeg")
    options=args.parse_args()
    for item in TRACKS:
        render(item,options.output,options.ffmpeg)

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, Play, Clock, Trash2, Volume2, Activity, ShieldAlert, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Recording {
  id: string;
  url: string;
  timestamp: number;
  duration: number;
}

type AppStatus = 'IDLE' | 'LISTENING' | 'RECORDING' | 'PLAYING';

export default function App() {
  const [status, setStatus] = useState<AppStatus>('IDLE');
  const [threshold, setThreshold] = useState(20); // Sensitivity threshold
  const [volume, setVolume] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const statusRef = useRef<AppStatus>('IDLE');
  const thresholdRef = useRef(20);

  // Keep refs in sync for the animation frame loop
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    thresholdRef.current = threshold;
  }, [threshold]);

  const fetchDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter(device => device.kind === 'audioinput');
      setDevices(audioInputs);
      if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch (err) {
      console.error('Error fetching devices:', err);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    fetchDevices();
    navigator.mediaDevices.addEventListener('devicechange', fetchDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', fetchDevices);
  }, [fetchDevices]);

  const startMonitoring = async () => {
    try {
      const constraints: MediaStreamConstraints = { 
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true 
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Refresh labels after permission granted
      fetchDevices();

      // Setup Audio Context for volume detection
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      setStatus('LISTENING');
      monitorVolume();
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('无法访问麦克风，请确保已授予权限。');
    }
  };

  const stopMonitoring = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) audioContextRef.current.close();
    
    setStatus('IDLE');
    setVolume(0);
  };

  const monitorVolume = useCallback(() => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const check = () => {
      if (statusRef.current !== 'LISTENING' && statusRef.current !== 'RECORDING') {
        animationFrameRef.current = requestAnimationFrame(check);
        return;
      }

      analyserRef.current!.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      setVolume(average);

      // Trigger recording if threshold exceeded and we are just listening
      if (average > thresholdRef.current && statusRef.current === 'LISTENING') {
        triggerRecording();
      }

      animationFrameRef.current = requestAnimationFrame(check);
    };

    check();
  }, [threshold]);

  const triggerRecording = async () => {
    if (!streamRef.current || statusRef.current !== 'LISTENING') return;

    setStatus('RECORDING');
    chunksRef.current = [];
    
    const mediaRecorder = new MediaRecorder(streamRef.current);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      
      const newRecording: Recording = {
        id: Math.random().toString(36).substr(2, 9),
        url,
        timestamp: Date.now(),
        duration: 5,
      };

      setRecordings(prev => [newRecording, ...prev]);
      autoPlay(url);
    };

    mediaRecorder.start();

    // Record for exactly 5 seconds
    let timeLeft = 5;
    setCountdown(timeLeft);
    const interval = setInterval(() => {
      timeLeft -= 1;
      setCountdown(timeLeft);
      if (timeLeft <= 0) {
        clearInterval(interval);
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }
    }, 1000);
  };

  const autoPlay = (url: string) => {
    setStatus('PLAYING');
    const audio = new Audio(url);
    
    audio.onended = () => {
      // Resume listening after playback ends
      setStatus('LISTENING');
      setCountdown(0);
    };

    audio.play().catch(err => {
      console.error('Playback failed:', err);
      setStatus('LISTENING');
    });
  };

  const deleteRecording = (id: string) => {
    setRecordings(prev => {
      const rec = prev.find(r => r.id === id);
      if (rec) URL.revokeObjectURL(rec.url);
      return prev.filter(r => r.id !== id);
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-white selection:text-black">
      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-12 flex justify-between items-start">
          <div>
            <h1 className="text-5xl font-bold tracking-tighter mb-2 italic">VOICE ECHO</h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em]">Autonomous Audio Feedback Loop</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-full px-4 py-1 flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${status === 'IDLE' ? 'bg-gray-500' : status === 'RECORDING' ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
            <span className="text-[10px] font-mono uppercase tracking-wider">{status}</span>
          </div>
        </header>

        {/* Status Display */}
        <section className="mb-12 relative aspect-video bg-white/5 rounded-[40px] border border-white/10 flex flex-col items-center justify-center overflow-hidden">
          {/* Visualizer Background */}
          <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
            <div 
              className="w-64 h-64 rounded-full border-2 border-white transition-all duration-100"
              style={{ transform: `scale(${1 + volume / 50})`, opacity: volume / 100 }}
            />
          </div>

          <AnimatePresence mode="wait">
            {status === 'IDLE' ? (
              <motion.button
                key="start"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                onClick={startMonitoring}
                className="group flex flex-col items-center gap-4"
              >
                <div className="w-24 h-24 rounded-full bg-white text-black flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Mic size={32} />
                </div>
                <span className="text-xs font-bold uppercase tracking-widest">Activate Listener</span>
              </motion.button>
            ) : (
              <motion.div
                key="active"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-6"
              >
                {status === 'LISTENING' && (
                  <>
                    <div className="flex items-center gap-1 h-12">
                      {[...Array(12)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ height: [4, Math.random() * 40 + 4, 4] }}
                          transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.05 }}
                          className="w-1 bg-white/40 rounded-full"
                        />
                      ))}
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-mono text-gray-400 uppercase tracking-widest mb-1">Monitoring Environment</p>
                      <p className="text-2xl font-light">Waiting for sound...</p>
                    </div>
                  </>
                )}

                {status === 'RECORDING' && (
                  <div className="text-center">
                    <div className="w-20 h-20 rounded-full border-4 border-red-500 flex items-center justify-center mb-4 mx-auto">
                      <span className="text-3xl font-bold text-red-500">{countdown}</span>
                    </div>
                    <p className="text-xs font-mono text-red-500 uppercase tracking-widest">Recording Active</p>
                  </div>
                )}

                {status === 'PLAYING' && (
                  <div className="text-center">
                    <div className="w-20 h-20 rounded-full bg-green-500 text-black flex items-center justify-center mb-4 mx-auto animate-bounce">
                      <Volume2 size={32} />
                    </div>
                    <p className="text-xs font-mono text-green-500 uppercase tracking-widest">Playing Back</p>
                    <p className="text-[10px] text-gray-500 mt-2 uppercase tracking-tighter italic">Listener Muted to Prevent Loop</p>
                  </div>
                )}

                <button 
                  onClick={stopMonitoring}
                  className="mt-8 text-[10px] text-gray-500 hover:text-white uppercase tracking-widest border-b border-gray-800 pb-1"
                >
                  Deactivate System
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="bg-white/5 p-6 rounded-3xl border border-white/10 col-span-1 md:col-span-2">
            <label className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">
              <Mic size={14} />
              Audio Input Source
            </label>
            <div className="relative">
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                disabled={status !== 'IDLE'}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId} className="bg-[#1a1a1a]">
                    {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                <ChevronDown size={16} />
              </div>
            </div>
          </div>

          <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
            <label className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">
              <Activity size={14} />
              Sensitivity Threshold
            </label>
            <div className="flex items-center gap-4">
              <input 
                type="range" 
                min="5" 
                max="100" 
                value={threshold}
                onChange={(e) => setThreshold(parseInt(e.target.value))}
                className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
              />
              <span className="font-mono text-sm">{threshold}</span>
            </div>
          </div>

          <div className="bg-white/5 p-6 rounded-3xl border border-white/10 flex items-center justify-between">
            <div>
              <label className="flex items-center gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
                <Clock size={14} />
                Fixed Duration
              </label>
              <p className="text-xl font-bold">5.0s</p>
            </div>
            <div className="p-3 bg-white/5 rounded-2xl">
              <ShieldAlert size={20} className="text-gray-500" />
            </div>
          </div>
        </div>

        {/* History */}
        <section>
          <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.3em] mb-6">Execution History</h2>
          <div className="space-y-2">
            {recordings.length === 0 ? (
              <div className="py-8 text-center border border-white/5 rounded-2xl text-gray-600 text-xs uppercase tracking-widest">
                No events recorded
              </div>
            ) : (
              recordings.map((rec) => (
                <div key={rec.id} className="bg-white/5 p-4 rounded-2xl border border-white/10 flex items-center justify-between group">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400">
                      <Play size={14} fill="currentColor" />
                    </div>
                    <div>
                      <p className="text-xs font-bold">Echo Event {rec.id}</p>
                      <p className="text-[10px] text-gray-500">{new Date(rec.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => deleteRecording(rec.id)}
                    className="opacity-0 group-hover:opacity-100 p-2 text-gray-500 hover:text-red-500 transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';
import AudioVisualizer from './AudioVisualizer';
import { ConnectionState } from '../types';
import { CalculatorIcon, MicrophoneIcon, StopIcon, TrashIcon } from '@heroicons/react/24/solid';

const VoiceCalculator: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [displayText, setDisplayText] = useState<string>('音声入力を開始');
  const [expression, setExpression] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Transcription & Logic Refs
  const currentInputRef = useRef<string>('');
  const isResultFinalRef = useRef<boolean>(false);

  // Tools Definition
  const displayResultTool: FunctionDeclaration = {
    name: 'displayResult',
    parameters: {
      type: Type.OBJECT,
      description: 'Display the calculated result immediately.',
      properties: {
        text: {
          type: Type.STRING,
          description: 'The numeric result or short text to display (e.g. "8").',
        },
      },
      required: ['text'],
    },
  };

  const resetAppTool: FunctionDeclaration = {
    name: 'resetApp',
    parameters: {
      type: Type.OBJECT,
      description: 'Reset the calculator state.',
      properties: {},
    },
  };

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    if (sessionRef.current) {
        sessionRef.current.then((session: any) => {
            try {
                session.close();
            } catch (e) {
                console.warn("Error closing session", e);
            }
        });
        sessionRef.current = null;
    }
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    setConnectionState(ConnectionState.DISCONNECTED);
    setAnalyser(null);
    currentInputRef.current = '';
    isResultFinalRef.current = false;
  }, []);

  const connect = async () => {
    try {
      setConnectionState(ConnectionState.CONNECTING);
      
      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        throw new Error("API Key not found");
      }

      const ai = new GoogleGenAI({ apiKey });

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const analyserNode = inputCtx.createAnalyser();
      analyserNode.fftSize = 256;
      setAnalyser(analyserNode);

      const source = inputCtx.createMediaStreamSource(stream);
      source.connect(analyserNode);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, // Enable transcription for real-time feedback
          systemInstruction: `
            あなたは超高速で反応する日本語音声計算機です。
            
            【ルール】
            1. ユーザーが数式（例：「3たす5」「100わる20」）を話したら、**即座に**計算してください。
            2. 計算結果が出たら、間髪入れずに 'displayResult' ツールを呼び出してください。
            3. 音声での返答は極めて短くしてください（例：「8です」「はい」）。
            4. 「リセット」「クリア」などの言葉には 'resetApp' ツールで反応してください。
            5. ユーザーがまだ言い終わっていないように聞こえても、計算可能な数式が成立した時点で計算して構いません。スピード重視です。
          `,
          tools: [{ functionDeclarations: [displayResultTool, resetAppTool] }],
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Connected');
            setConnectionState(ConnectionState.CONNECTED);
            
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             // 1. Handle Real-time Transcription (Formula Display)
             const inputTr = message.serverContent?.inputTranscription;
             if (inputTr && inputTr.text) {
                 if (isResultFinalRef.current) {
                     // If we are starting a new sentence after a result, clear the old "formula"
                     currentInputRef.current = '';
                     // Also clear the display text to indicate fresh start? 
                     // Or keep result until new result? Let's keep result but clear expression.
                     setExpression('');
                     isResultFinalRef.current = false;
                 }
                 currentInputRef.current += inputTr.text;
                 setExpression(currentInputRef.current);
             }

             // 2. Handle Tool Calls
             if (message.toolCall) {
                console.log('Tool Call:', message.toolCall);
                const functionResponses = [];
                for (const fc of message.toolCall.functionCalls) {
                    let result = "ok";
                    if (fc.name === 'displayResult') {
                        const text = (fc.args as any).text;
                        setDisplayText(text);
                        // Save to history
                        setHistory(prev => [`${currentInputRef.current} = ${text}`, ...prev].slice(0, 10));
                        isResultFinalRef.current = true;
                    } else if (fc.name === 'resetApp') {
                        setDisplayText('0');
                        setExpression('');
                        currentInputRef.current = '';
                        setHistory([]);
                        isResultFinalRef.current = false;
                    }
                    functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result }
                    });
                }
                sessionPromise.then(session => {
                    session.sendToolResponse({ functionResponses: { responses: functionResponses } });
                });
             }

             // 3. Handle Audio Output
             const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             if (base64Audio) {
                 const ctx = outputAudioContextRef.current;
                 if (ctx) {
                     nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                     const audioBuffer = await decodeAudioData(
                         decode(base64Audio),
                         ctx,
                         24000,
                         1
                     );
                     const source = ctx.createBufferSource();
                     source.buffer = audioBuffer;
                     source.connect(ctx.destination);
                     source.addEventListener('ended', () => {
                         sourcesRef.current.delete(source);
                     });
                     source.start(nextStartTimeRef.current);
                     nextStartTimeRef.current += audioBuffer.duration;
                     sourcesRef.current.add(source);
                 }
             }
          },
          onclose: () => {
            console.log('Gemini Live Closed');
            setConnectionState(ConnectionState.DISCONNECTED);
          },
          onerror: (err) => {
            console.error('Gemini Live Error', err);
            setConnectionState(ConnectionState.ERROR);
            cleanup();
          }
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (error) {
      console.error("Connection failed", error);
      setConnectionState(ConnectionState.ERROR);
    }
  };

  const toggleConnection = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      cleanup();
    } else {
      connect();
    }
  };
  
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const handleManualReset = () => {
      setDisplayText('0');
      setExpression('');
      setHistory([]);
      currentInputRef.current = '';
      isResultFinalRef.current = false;
  };

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto p-6 bg-white rounded-3xl shadow-xl border border-gray-100">
      {/* Header */}
      <div className="flex items-center gap-2 mb-8 self-start">
        <div className="p-2 bg-indigo-100 rounded-lg">
           <CalculatorIcon className="w-6 h-6 text-indigo-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">AI Voice Calculator</h1>
      </div>

      {/* Main Display */}
      <div className="w-full mb-8">
        <div className="bg-gray-50 rounded-2xl p-6 mb-4 h-48 flex flex-col items-end justify-center overflow-hidden border border-gray-200 shadow-inner relative">
          
          {/* Formula / Transcription Display */}
          <div className="w-full text-right mb-2 px-2 overflow-hidden whitespace-nowrap text-ellipsis">
            <span className="text-xl text-gray-400 font-medium font-mono min-h-[1.5rem] block">
               {expression || '\u00A0'}
            </span>
          </div>

          {/* Main Result Display */}
          <span className={`font-mono tracking-tight text-gray-900 transition-all duration-200 ${
              displayText.length > 8 ? 'text-4xl' : 'text-6xl'
          } ${displayText.length > 15 ? 'text-2xl' : ''}`}>
             {displayText}
          </span>
          
        </div>
        
        {/* Connection Status Indicator */}
        <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${
                    connectionState === ConnectionState.CONNECTED ? 'bg-green-500 animate-pulse' :
                    connectionState === ConnectionState.CONNECTING ? 'bg-yellow-500' :
                    connectionState === ConnectionState.ERROR ? 'bg-red-500' :
                    'bg-gray-300'
                }`} />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {connectionState === ConnectionState.CONNECTED ? 'Live' : 
                     connectionState === ConnectionState.CONNECTING ? 'Connecting...' : 
                     connectionState === ConnectionState.ERROR ? 'Error' : 'Offline'}
                </span>
            </div>
            {connectionState === ConnectionState.CONNECTED && (
                 <span className="text-xs text-indigo-500 font-semibold animate-pulse">Listening...</span>
            )}
        </div>
      </div>

      {/* Visualizer */}
      <div className="w-full mb-8 relative">
          <AudioVisualizer analyser={analyser} isActive={connectionState === ConnectionState.CONNECTED} />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6">
           <button 
            onClick={handleManualReset}
            className="p-4 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors duration-200"
            aria-label="Reset"
          >
             <TrashIcon className="w-6 h-6" />
          </button>

          <button
            onClick={toggleConnection}
            className={`p-6 rounded-full shadow-lg transition-all duration-300 transform hover:scale-105 active:scale-95 ${
                connectionState === ConnectionState.CONNECTED 
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-200' 
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
            }`}
          >
            {connectionState === ConnectionState.CONNECTED ? (
                <StopIcon className="w-8 h-8" />
            ) : (
                <MicrophoneIcon className="w-8 h-8" />
            )}
          </button>
      </div>

      {/* History Log */}
      {history.length > 0 && (
          <div className="w-full mt-8 pt-6 border-t border-gray-100">
             <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Recent</h3>
             <div className="flex flex-col gap-2 opacity-70">
                 {history.slice(0, 3).map((item, idx) => (
                     <div key={idx} className="text-right text-lg text-gray-600 font-mono">
                         {item}
                     </div>
                 ))}
             </div>
          </div>
      )}

      {/* Instructions */}
      <div className="mt-8 text-center text-gray-400 text-sm">
        <p>「3たす5は？」「100割る4は？」</p>
        <p className="mt-1">「リセット」でクリア</p>
      </div>
    </div>
  );
};

export default VoiceCalculator;

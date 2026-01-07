import React from 'react';
import VoiceCalculator from './components/VoiceCalculator';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="absolute inset-0 z-0 overflow-hidden">
         {/* Abstract background decorative elements */}
         <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
         <div className="absolute top-0 right-1/4 w-96 h-96 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
         <div className="absolute -bottom-32 left-1/3 w-96 h-96 bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
      </div>
      
      <div className="relative z-10 w-full max-w-lg">
        <VoiceCalculator />
      </div>
    </div>
  );
};

export default App;

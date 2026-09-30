/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, Volume2, ArrowRight, Star, Sparkles, Send, RefreshCw, Trophy, BookOpen, User } from 'lucide-react';
import { VOCABULARY_DAYS, Word } from './data/vocabulary';
import { db, auth } from './lib/firebase';
import { signInAnonymously, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, arrayUnion, Timestamp, collection, addDoc } from 'firebase/firestore';

// Types
type AppView = 'greeting' | 'learning' | 'quiz' | 'completed';

export default function App() {
  const [view, setView] = useState<AppView>('greeting');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizInput, setQuizInput] = useState('');
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [wrongWords, setWrongWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDay, setCurrentDay] = useState(1);
  const [dailyWords, setDailyWords] = useState<Word[]>([]);
  const [testStartTime, setTestStartTime] = useState<number | null>(null);
  const [quizResults, setQuizResults] = useState<{word: string, answer: string, correct: boolean}[]>([]);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [isSimulatedEmail, setIsSimulatedEmail] = useState<boolean | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Get words for current day
  useEffect(() => {
    let dayWords = VOCABULARY_DAYS[currentDay];
    if (!dayWords || dayWords.length === 0) {
      setCurrentDay(1);
    } else {
      setDailyWords(dayWords);
    }
  }, [currentDay]);

  // Auth & Progress Loading
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        await loadProgress(user.uid);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (error: any) {
          // If anonymous auth fails, we just use local storage
          await loadProgress('local-user');
        }
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const sendResultToDeveloper = async (results: typeof quizResults, durationSeconds: number) => {
    try {
      setEmailStatus('sending');
      setEmailError(null);
      const dateStr = new Date().toLocaleString('zh-TW');
      const response = await fetch('/api/send-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ results, durationSeconds, dateStr })
      });
      
      if (response.ok) {
        const data = await response.json();
        setIsSimulatedEmail(!!data.simulated);
        setEmailStatus('sent');
        setEmailError(null);
        console.log("Report sent successfully!", data);
        return true;
      } else {
        const data = await response.json().catch(() => ({}));
        let errMsg = data.error || "伺服器傳回錯誤，但未提供詳細訊息";
        if (data.hint) {
          errMsg += `\n\n💡 建議：${data.hint}`;
        }
        setEmailError(errMsg);
        setEmailStatus('failed');
        console.error("Failed to send report", data);
        return false;
      }
    } catch (error: any) {
      setEmailError(error?.message || String(error));
      setEmailStatus('failed');
      console.error("Error calling send-report API:", error);
      return false;
    }
  };

  const loadProgress = async (uid: string) => {
    try {
      if (uid === 'local-user') {
        const localData = localStorage.getItem('qingqing-progress');
        if (localData) {
          const data = JSON.parse(localData);
          setCurrentDay(data.currentDay || 1);
        }
        return;
      }

      const docRef = doc(db, 'users', uid, 'progress', 'current');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        setCurrentDay(data.currentDay || 1);
      } else {
        await setDoc(docRef, {
          userId: uid,
          currentDay: 1,
          completedWordsCount: 0,
          wrongWords: [],
          lastActiveDate: Timestamp.now()
        });
      }
    } catch (error) {
      console.error("Error loading progress:", error);
      // Fallback if Firestore fails (e.g. permission denied)
      const localData = localStorage.getItem('qingqing-progress');
      if (localData) {
        const data = JSON.parse(localData);
        setCurrentDay(data.currentDay || 1);
      }
    }
  };

  const updateProgress = async (completedDay: number, results: typeof quizResults) => {
    const wrongOnes = dailyWords.filter((_, i) => !results[i].correct);
    const duration = testStartTime ? Math.floor((Date.now() - testStartTime) / 1000) : 0;

    // Save to local storage update first for best experience
    localStorage.setItem('qingqing-progress', JSON.stringify({
      currentDay: completedDay + 1,
      lastActiveDate: new Date().toISOString()
    }));

    // Send Report to Developer
    await sendResultToDeveloper(results, duration);

    if (!user) return;
    try {
      const docRef = doc(db, 'users', user.uid, 'progress', 'current');
      await updateDoc(docRef, {
        currentDay: completedDay + 1,
        wrongWords: arrayUnion(...wrongOnes.map(w => w.word)),
        lastActiveDate: Timestamp.now()
      });

      // Log the session
      await addDoc(collection(db, 'users', user.uid, 'logs'), {
        userId: user.uid,
        date: Timestamp.now(),
        wordsLearned: dailyWords.length,
        quizScore: results.filter(r => r.correct).length,
        durationSeconds: duration,
        wrongWords: wrongOnes.map(w => w.word)
      });
    } catch (error) {
      console.error("Error updating progress:", error);
    }
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  };

  const handleNextWord = () => {
    if (currentWordIndex < dailyWords.length - 1) {
      setCurrentWordIndex(prev => prev + 1);
    }
  };

  const handlePrevWord = () => {
    if (currentWordIndex > 0) {
      setCurrentWordIndex(prev => prev - 1);
    }
  };

  const startQuiz = () => {
    setTestStartTime(Date.now());
    setQuizResults([]);
    setView('quiz');
  };

  const handleQuizSubmit = (e: FormEvent) => {
    e.preventDefault();
    const currentWord = dailyWords[quizIndex];
    const isAnsCorrect = quizInput.toLowerCase().trim() === currentWord.word.toLowerCase();
    
    if (isAnsCorrect) {
      setIsCorrect(true);
      speak("Wonderful! You got it right!");
    } else {
      setIsCorrect(false);
      speak("Almost there! Try again, Qing Qing!");
    }

    const newResult = { word: currentWord.word, answer: quizInput, correct: isAnsCorrect };
    
    setTimeout(() => {
      if (isAnsCorrect) {
        setIsCorrect(null);
        setQuizInput('');
        const updatedResults = [...quizResults, newResult];
        setQuizResults(updatedResults);
        
        if (quizIndex < dailyWords.length - 1) {
          setQuizIndex(prev => prev + 1);
        } else {
          updateProgress(currentDay, updatedResults);
          setView('completed');
        }
      } else {
        setIsCorrect(null);
        // We let them try again but we mark it as wrong in the final report if they failed once?
        // Actually the user wants "成果(他的答案)", so maybe just the first try or the final outcome.
        // Let's keep it simple: if they fail, they stay on the word until right, but we log the wrong answer too.
        // Or better: just move on if they are wrong? No, learning app should probably repeat.
        // For the Gmail report, let's track all attempts or just mark as wrong.
        if (!wrongWords.find(w => w.word === currentWord.word)) {
          setWrongWords(prev => [...prev, currentWord]);
          setQuizResults(prev => [...prev, newResult]);
        }
      }
    }, 1500);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-pink-50 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCw className="text-pink-400 w-12 h-12" />
        </motion.div>
      </div>
    );
  }

  return (
    <div id="app-container" className="min-h-screen bg-pink-50 font-sans text-gray-800 p-4 md:p-8">
      {/* Background Decorations */}
      <div className="fixed top-20 left-10 text-pink-200 opacity-50"><Heart size={40} fill="currentColor" /></div>
      <div className="fixed bottom-20 right-10 text-pink-200 opacity-50"><Star size={40} fill="currentColor" /></div>
      
      {/* App Header */}
      <header className="fixed top-0 left-0 right-0 p-4 flex justify-between items-center z-50 pointer-events-none">
        <div className="bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full border-2 border-pink-100 text-pink-500 font-bold shadow-sm pointer-events-auto">
          🌸 晴晴加油！
        </div>
      </header>

      <main className="max-w-xl mx-auto bento-container">
        <AnimatePresence mode="wait">
          {view === 'greeting' && (
            <GreetingView 
              key="greeting" 
              setView={() => setView('learning')} 
              currentDay={currentDay}
              words={dailyWords}
              onSelectDay={(day) => {
                setCurrentDay(day);
                setCurrentWordIndex(0);
                setQuizIndex(0);
                setWrongWords([]);
              }}
            />
          )}

          {view === 'learning' && (
            <LearningStage 
              key={`learning-${currentWordIndex}`}
              word={dailyWords[currentWordIndex]} 
              index={currentWordIndex}
              total={dailyWords.length}
              onNext={handleNextWord}
              onPrev={handlePrevWord}
              onStartQuiz={startQuiz}
              onSpeak={speak}
            />
          )}

          {view === 'quiz' && (
            <QuizStage 
              key={`quiz-${quizIndex}`}
              word={dailyWords[quizIndex]}
              index={quizIndex}
              total={dailyWords.length}
              input={quizInput}
              setInput={setQuizInput}
              onSubmit={handleQuizSubmit}
              isCorrect={isCorrect}
              onSpeak={speak}
            />
          )}

          {view === 'completed' && (
            <CompletionStage 
              key="completed"
              wrongWords={wrongWords}
              totalWords={dailyWords.length}
              emailStatus={emailStatus}
              emailError={emailError}
              isSimulatedEmail={isSimulatedEmail}
              currentDay={currentDay}
              onRestart={() => {
                // Automatically go to the next day!
                setCurrentDay(prev => prev + 1);
                setView('greeting');
                setCurrentWordIndex(0);
                setQuizIndex(0);
                setWrongWords([]);
                setEmailStatus('idle');
                setIsSimulatedEmail(null);
                setEmailError(null);
              }}
              onResendEmail={async () => {
                const duration = testStartTime ? Math.floor((Date.now() - testStartTime) / 1000) : 0;
                await sendResultToDeveloper(quizResults, duration);
              }}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// Sub-components

const GreetingView: React.FC<{ 
  setView: () => void; 
  currentDay: number; 
  words: Word[]; 
  onSelectDay: (day: number) => void;
}> = ({ setView, currentDay, words, onSelectDay }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="bg-white rounded-3xl p-8 shadow-xl text-center border-4 border-pink-200"
    >
      <div className="mb-6 flex justify-center">
        <div className="bg-pink-100 p-4 rounded-full">
          <Heart className="text-pink-500 w-16 h-16" fill="currentColor" />
        </div>
      </div>
      <h1 className="text-3xl font-bold text-pink-600 mb-2">晴晴背單字</h1>
      <p className="text-md text-pink-400 mb-6 font-medium">
        我的晴晴又要來背單字了嗎？真棒！✨
      </p>

      <div className="bg-pink-50/50 rounded-2xl p-5 mb-8 border-2 border-pink-50">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-pink-600 flex items-center gap-1.5 text-base md:text-lg">
              📅 單字範圍
            </span>
            <select
              value={currentDay}
              onChange={(e) => onSelectDay(Number(e.target.value))}
              className="bg-white border-2 border-pink-300 text-pink-600 font-bold px-3 py-1 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-400 cursor-pointer shadow-sm"
            >
              {Object.keys(VOCABULARY_DAYS).map((d) => (
                <option key={d} value={d}>
                  第 {d} 天 ({VOCABULARY_DAYS[Number(d)]?.[0]?.word || ''} ~ {VOCABULARY_DAYS[Number(d)]?.[VOCABULARY_DAYS[Number(d)].length - 1]?.word || ''})
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onSelectDay(Math.max(1, currentDay - 1))}
              disabled={currentDay === 1}
              className="px-3 py-1 text-xs bg-white border border-pink-200 text-pink-500 font-bold rounded-lg hover:bg-pink-100 disabled:opacity-40"
            >
              前一天
            </button>
            <button
              onClick={() => onSelectDay(currentDay + 1)}
              disabled={currentDay === Object.keys(VOCABULARY_DAYS).length}
              className="px-3 py-1 text-xs bg-white border border-pink-200 text-pink-500 font-bold rounded-lg hover:bg-pink-100 disabled:opacity-40"
            >
              後一天
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-center max-h-[160px] overflow-y-auto pr-1">
          {words.map((w, index) => (
            <span key={`${w.word}-${index}`} className="bg-white px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-700 shadow-sm border border-pink-100">
              {w.word}
            </span>
          ))}
          {words.length === 0 && (
            <span className="text-gray-400 text-sm">此天尚無單字列表</span>
          )}
        </div>
      </div>

      <button 
        onClick={setView}
        className="w-full py-4 bg-pink-500 hover:bg-pink-600 text-white rounded-2xl text-xl font-bold transition-all transform hover:scale-105 active:scale-95 shadow-lg flex items-center justify-center gap-2"
      >
        我要來背單字了！ <ArrowRight />
      </button>
    </motion.div>
  );
}

const LearningStage: React.FC<{ 
  word: Word, index: number, total: number, onNext: () => void, onPrev: () => void, onStartQuiz: () => void, onSpeak: (t: string) => void 
}> = ({ word, index, total, onNext, onPrev, onStartQuiz, onSpeak }) => {
  const isLast = index === total - 1;

  return (
    <motion.div 
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="bg-white rounded-3xl p-8 shadow-xl border-4 border-pink-200"
    >
      <div className="flex justify-between items-center mb-6">
        <span className="bg-pink-100 text-pink-500 px-3 py-1 rounded-full text-sm font-bold">
          第 {index + 1} / {total} 個
        </span>
        <button 
          onClick={(e) => { e.stopPropagation(); onSpeak(word.word); }}
          className="bg-pink-500 text-white p-3 rounded-full hover:bg-pink-600 transition-colors shadow-md"
        >
          <Volume2 size={24} />
        </button>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-5xl font-bold text-pink-600 mb-2 tracking-wide">{word.word}</h2>
        <div className="flex justify-center gap-2 mb-4">
          <span className="text-gray-400 italic">{word.pos}</span>
          <span className="text-2xl font-medium text-pink-400">{word.chinese}</span>
        </div>
      </div>

      <div className="bg-pink-50 p-6 rounded-2xl mb-8">
        <h3 className="text-sm font-bold text-pink-400 mb-2 flex items-center gap-1">
          <Sparkles size={14} /> 例句
        </h3>
        <p className="text-lg text-gray-700 leading-relaxed italic mb-2">"{word.example}"</p>
        <p className="text-sm text-gray-500">{word.exampleChinese}</p>
      </div>

      <div className="flex gap-4">
        <button 
          onClick={onPrev}
          disabled={index === 0}
          className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 border-2 
            ${index === 0 ? 'border-gray-100 text-gray-300' : 'border-pink-200 text-pink-500 hover:bg-pink-50'}`}
        >
          上一個
        </button>
        {isLast ? (
          <button 
            onClick={onStartQuiz}
            className="flex-1 py-3 bg-pink-500 hover:bg-pink-600 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg"
          >
            開始測驗 <Sparkles size={18} />
          </button>
        ) : (
          <button 
            onClick={onNext}
            className="flex-1 py-3 bg-white border-2 border-pink-200 text-pink-500 hover:bg-pink-50 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
          >
            下一個
          </button>
        )}
      </div>
    </motion.div>
  );
}

const QuizStage: React.FC<{ 
  word: Word, index: number, total: number, input: string, setInput: (v: string) => void, 
  onSubmit: (e: FormEvent) => void, isCorrect: boolean | null, onSpeak: (t: string) => void
}> = ({ word, index, total, input, setInput, onSubmit, isCorrect, onSpeak }) => {
  // Randomly decide if we show Chinese or Audio-only
  const [mode, setMode] = useState<'chinese' | 'audio'>(Math.random() > 0.5 ? 'chinese' : 'audio');

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-3xl p-8 shadow-xl border-4 border-pink-200 relative overflow-hidden"
    >
      <AnimatePresence>
        {isCorrect === true && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 0.1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-green-500 z-0"
          />
        )}
        {isCorrect === false && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 0.1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-red-500 z-0"
          />
        )}
      </AnimatePresence>

      <div className="relative z-10">
        <div className="flex justify-between items-center mb-6">
          <span className="bg-purple-100 text-purple-500 px-3 py-1 rounded-full text-sm font-bold">
            測驗時間！ {index + 1} / {total}
          </span>
          {mode === 'audio' && (
            <button 
              onClick={() => onSpeak(word.word)}
              className="bg-purple-500 text-white p-3 rounded-full hover:bg-purple-600 transition-colors shadow-lg animate-pulse"
            >
              <Volume2 size={24} />
            </button>
          )}
        </div>

        <div className="text-center mb-8 min-h-[140px] flex flex-col justify-center">
          <p className="text-lg text-gray-500 mb-2">
            {mode === 'chinese' ? '看到這個中文要拼出：' : '聽到這個發音要拼出：'}
          </p>
          {mode === 'chinese' ? (
            <h2 className="text-4xl font-bold text-purple-600 mb-4">{word.chinese}</h2>
          ) : (
            <div className="flex justify-center mb-4">
               <button 
                onClick={() => onSpeak(word.word)}
                className="bg-purple-50 text-purple-500 px-6 py-4 rounded-3xl border-2 border-purple-200 hover:bg-purple-100 transition-all flex items-center gap-3 font-bold"
              >
                <Volume2 size={32} /> 再聽一次
              </button>
            </div>
          )}
          <p className="text-sm text-gray-400 italic">({word.pos})</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <input 
            type="text"
            autoFocus
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isCorrect !== null}
            placeholder="答案在這邊輸入..."
            className={`w-full text-center text-3xl font-bold py-4 rounded-2xl border-4 outline-none transition-all
              ${isCorrect === null ? 'border-purple-100 focus:border-purple-300' : 
                isCorrect === true ? 'border-green-300 bg-green-50 text-green-600' : 'border-red-300 bg-red-50 text-red-600'}
            `}
          />
          
          <button 
            type="submit"
            disabled={isCorrect !== null}
            className="w-full py-4 bg-purple-500 hover:bg-purple-600 text-white rounded-2xl text-xl font-bold shadow-lg flex items-center justify-center gap-2"
          >
            我寫好了！ <Send size={20} />
          </button>
        </form>

        <div className="h-12 mt-4 flex items-center justify-center">
          {isCorrect === true && (
            <motion.p initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="text-green-500 font-bold text-xl flex items-center gap-2">
              <Star fill="currentColor" /> 真棒！晴晴答對了！ <Star fill="currentColor" />
            </motion.p>
          )}
          {isCorrect === false && (
            <motion.p initial={{ x: -10 }} animate={{ x: [ -10, 10, -10, 10, 0 ] }} className="text-red-500 font-bold">
              加油晴晴！差一點點就對了！🧸
            </motion.p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

const CompletionStage: React.FC<{ 
  wrongWords: Word[]; 
  totalWords: number; 
  emailStatus: 'idle' | 'sending' | 'sent' | 'failed';
  emailError: string | null;
  isSimulatedEmail: boolean | null;
  currentDay: number;
  onRestart: () => void;
  onResendEmail: () => void;
}> = ({ wrongWords, totalWords, emailStatus, emailError, isSimulatedEmail, currentDay, onRestart, onResendEmail }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-3xl p-8 shadow-xl border-4 border-pink-200 text-center"
    >
      <div className="mb-6 flex justify-center">
        <div className="bg-yellow-100 p-4 rounded-full relative">
          <Trophy className="text-yellow-500 w-20 h-20" />
          <motion.div 
            animate={{ scale: [1, 1.2, 1] }} 
            transition={{ repeat: Infinity, duration: 2 }}
            className="absolute -top-2 -right-2 bg-pink-500 text-white p-2 rounded-full"
          >
            <Sparkles size={20} />
          </motion.div>
        </div>
      </div>

      <h2 className="text-4xl font-bold text-pink-600 mb-2">學習完成！</h2>
      <p className="text-lg text-gray-500 mb-6">晴晴完成第 {currentDay} 天的學習，真棒！💖</p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-pink-50 p-4 rounded-2xl">
          <p className="text-sm text-pink-400 font-bold">答對單字</p>
          <p className="text-3xl font-black text-pink-600">{totalWords - wrongWords.length}</p>
        </div>
        <div className="bg-purple-50 p-4 rounded-2xl">
          <p className="text-sm text-purple-400 font-bold">有待加油</p>
          <p className="text-3xl font-black text-purple-600">{wrongWords.length}</p>
        </div>
      </div>

      {/* Mailing Status Block */}
      <div className="bg-pink-50/50 border-2 border-pink-100 rounded-2xl p-4 mb-6">
        <h3 className="text-sm font-bold text-pink-500 mb-2 flex items-center justify-center gap-1.5">
          <Send size={14} /> 成果報告寄送狀態
        </h3>
        {emailStatus === 'sending' && (
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <RefreshCw className="w-4 h-4 animate-spin text-pink-400" />
            <span className="text-sm font-medium">正在將成果送出至開發者信箱...</span>
          </div>
        )}
        {emailStatus === 'sent' && (
          <div className="text-green-600">
            <p className="text-sm font-bold flex items-center justify-center gap-1">
              ✨ {isSimulatedEmail ? "📧 模擬寄送成功！" : "📬 成果已正式寄出！"}
            </p>
            <p className="text-xs text-gray-500 mt-1 mb-2">
              {isSimulatedEmail 
                ? "系統模擬已登記 (成果預期寄送至 b12203064@gmail.com)" 
                : "作答成果已成功發送至 b12203064@gmail.com"}
            </p>
            <button
              onClick={onResendEmail}
              className="px-3 py-1 bg-white border border-green-200 hover:bg-green-50 text-green-600 font-medium text-xs rounded-lg transition-all"
            >
              再次發送份數 📬
            </button>
          </div>
        )}
        {emailStatus === 'failed' && (
          <div className="text-red-500 text-xs">
            <p className="font-bold flex items-center justify-center gap-1">⚠️ 郵件寄出失敗</p>
            <p className="text-gray-500 mt-1 mb-2">
              請檢查網路連線。晴晴的學習紀錄仍安全地保存在您的本地裝置中。
            </p>
            {emailError && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-2.5 rounded-xl text-left font-mono mt-2 mb-3 max-h-[120px] overflow-y-auto whitespace-pre-wrap break-all text-[11px]">
                <strong>詳細錯誤訊息：</strong><br />
                {emailError}
              </div>
            )}
            <button
              onClick={onResendEmail}
              className="px-3 py-1.5 bg-pink-100 hover:bg-pink-200 text-pink-600 font-bold text-xs rounded-xl transition-all"
            >
              🔄 點此重新發送
            </button>
          </div>
        )}
        {emailStatus === 'idle' && (
          <div className="flex flex-col items-center">
            <p className="text-xs text-gray-400 mb-2">尚未觸發成果發送</p>
            <button
              onClick={onResendEmail}
              className="px-3 py-1.5 bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs rounded-xl transition-all shadow-sm"
            >
              🚀 手動傳送成果報告到開發者信箱
            </button>
          </div>
        )}
      </div>

      {wrongWords.length > 0 && (
        <div className="mb-6 text-left">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <BookOpen size={16} /> 這些單字可以再複習一下：
          </h3>
          <div className="flex flex-wrap gap-2">
            {wrongWords.map(w => (
              <span key={w.word} className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs font-semibold animate-pulse">
                {w.word}
              </span>
            ))}
          </div>
        </div>
      )}

      <button 
        onClick={onRestart}
        className="w-full py-4 bg-pink-500 hover:bg-pink-600 text-white rounded-2xl text-xl font-bold shadow-lg flex items-center justify-center gap-2 transition-all transform hover:scale-105 active:scale-95"
      >
        自動換隔天的範圍！ <Heart fill="currentColor" size={20} />
      </button>
    </motion.div>
  );
}

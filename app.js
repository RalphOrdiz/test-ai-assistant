const chatWindow = document.getElementById('chatWindow');
const summarySection = document.getElementById('summarySection');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const startVoiceBtn = document.getElementById('startVoiceBtn');
const speakToggleBtn = document.getElementById('speakToggleBtn');
const voiceStatus = document.getElementById('voiceStatus');
const speechStatus = document.getElementById('speechStatus');

const questions = [
  { key: 'surname', label: 'Surname', prompt: 'What is your surname?' },
  { key: 'firstName', label: 'First Name', prompt: 'What is your first name?' },
  { key: 'middleName', label: 'Middle Name', prompt: 'What is your middle name? Say none if not applicable.' },
  { key: 'address', label: 'Complete Residential Address', prompt: 'What is your complete residential address?' },
  { key: 'citizenship', label: 'Citizenship', prompt: 'What is your citizenship?' },
  { key: 'sex', label: 'Sex', prompt: 'What is your sex?' },
  { key: 'placeOfBirth', label: 'Place of Birth', prompt: 'What is your place of birth?' },
  { key: 'dateOfBirth', label: 'Date of Birth', prompt: 'What is your date of birth?' },
  { key: 'height', label: 'Height', prompt: 'What is your height? In centimeters or feet and inches.' },
  { key: 'weight', label: 'Weight', prompt: 'What is your weight? In kilograms or pounds.' },
  { key: 'civilStatus', label: 'Civil Status', prompt: 'What is your civil status? Single, Married, Widowed, Legally Separated, or Divorced.' },
  { key: 'profession', label: 'Profession / Occupation / Business', prompt: 'What is your profession, occupation, or business?' },
  { key: 'hasTin', label: 'Has TIN Number', prompt: 'Do you have a TIN number? Please answer yes or no.' },
  { key: 'tinNumber', label: 'TIN Number', prompt: 'If yes, please say your TIN number slowly.', conditional: (answers) => /^y(es)?$/i.test(answers.hasTin || '') }
];

const answers = {};
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

let step = 0;
let interviewStarted = false;
let isListening = false;
let isProcessingTurn = false;
let shouldListen = false;
let speechEnabled = false;
let preferredVoice = null;

if (recognition) {
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
}

function setStatus(text) {
  voiceStatus.textContent = `Status: ${text}`;
}

function setSpeechStatus(text) {
  speechStatus.textContent = `AI voice: ${text}`;
}

function updateSpeakToggle() {
  speakToggleBtn.textContent = speechEnabled ? 'AI Voice On' : 'AI Voice Off';
  speakToggleBtn.setAttribute('aria-pressed', String(speechEnabled));

  if (!('speechSynthesis' in window)) {
    setSpeechStatus('Not supported in this browser.');
    speakToggleBtn.disabled = true;
    return;
  }

  if (!speechEnabled) {
    setSpeechStatus('Off. Turn it on manually when you want spoken prompts.');
    return;
  }

  const voiceLabel = preferredVoice ? `${preferredVoice.name} (${preferredVoice.lang})` : 'Default browser voice';
  setSpeechStatus(`On using ${voiceLabel}.`);
}

function addMessage(text, role) {
  const bubble = document.createElement('div');
  bubble.className = `msg ${role}`;
  bubble.textContent = text;
  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function getActiveQuestion() {
  while (step < questions.length) {
    const q = questions[step];
    if (q.conditional && !q.conditional(answers)) {
      answers[q.key] = 'N/A';
      step += 1;
      continue;
    }
    return q;
  }
  return null;
}

function normalizeCivilStatus(value) {
  const options = ['single', 'married', 'widowed', 'legally separated', 'divorced'];
  const cleaned = value.trim().toLowerCase();
  const found = options.find((option) => option === cleaned);
  if (!found) return value;
  return found
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function storeAnswer(raw) {
  const q = getActiveQuestion();
  if (!q) return;

  let value = raw.trim();
  if (q.key === 'civilStatus') {
    value = normalizeCivilStatus(value);
  }

  answers[q.key] = value;
  step += 1;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

function scoreVoice(voice) {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();

  if (!lang.startsWith('en')) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (/en(-|_)?ph/.test(lang)) score += 90;
  else if (/en(-|_)?us/.test(lang)) score += 80;
  else if (/en(-|_)?gb/.test(lang)) score += 70;
  else score += 50;

  if (/natural|neural|online/.test(name)) score += 60;
  if (/aria|jenny|guy|samantha|zira|davis|libby|sonia|mark|michelle/.test(name)) score += 35;
  if (/google|microsoft/.test(name)) score += 20;
  if (voice.default) score += 15;
  if (/desktop/.test(name)) score -= 5;
  if (/espeak|festival|compact/.test(name)) score -= 80;

  return score;
}

function pickPreferredVoice() {
  if (!('speechSynthesis' in window)) {
    preferredVoice = null;
    return null;
  }

  const voices = window.speechSynthesis.getVoices();
  const ranked = voices
    .filter((voice) => /^en(-|_)?/i.test(voice.lang))
    .sort((a, b) => scoreVoice(b) - scoreVoice(a));

  preferredVoice = ranked[0] || voices[0] || null;
  return preferredVoice;
}

function prepareSpeechText(text) {
  return text
    .replace(/\bTIN\b/g, 'T I N')
    .replace(/\bPDF\b/g, 'P D F')
    .replace(/\s+/g, ' ')
    .trim();
}

function chunkSpeech(text, maxLength = 180) {
  const normalized = prepareSpeechText(text);
  if (!normalized) return [];

  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (!sentence) continue;
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (sentence.length <= maxLength) {
      current = sentence;
      continue;
    }

    const parts = sentence.split(/,\s+/);
    current = '';
    for (const part of parts) {
      const candidate = current ? `${current}, ${part}` : part;
      if (candidate.length <= maxLength) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = part;
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [normalized];
}

function speakChunk(text) {
  return new Promise((resolve) => {
    if (!speechEnabled || !('speechSynthesis' in window)) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickPreferredVoice();

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'en-US';
    }

    utterance.rate = 0.94;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    window.speechSynthesis.speak(utterance);
  });
}

async function speakText(text) {
  if (!speechEnabled || !('speechSynthesis' in window)) {
    return;
  }

  const chunks = chunkSpeech(text);
  if (!chunks.length) {
    return;
  }

  window.speechSynthesis.cancel();

  for (const chunk of chunks) {
    if (!speechEnabled) {
      break;
    }
    await speakChunk(chunk);
  }
}

async function botSay(text) {
  addMessage(text, 'bot');
  await speakText(text);
}

function startListening() {
  if (!recognition || isListening || !interviewStarted || !shouldListen || isProcessingTurn) return;
  const q = getActiveQuestion();
  if (!q) return;

  try {
    isListening = true;
    setStatus('Listening... please speak now.');
    recognition.start();
  } catch (_error) {
    isListening = false;
    setStatus('Microphone busy. Please try again in a moment.');
  }
}

async function askClarification(helpRequest, questionPrompt) {
  const data = await postJson('/api/clarify', {
    message: helpRequest,
    currentQuestion: questionPrompt,
    collectedAnswers: answers
  });

  return data.reply || 'Please answer in your own words.';
}

async function interpretTurn(userSpeech, question) {
  return postJson('/api/interpret-turn', {
    userSpeech,
    currentQuestion: question.prompt,
    fieldLabel: question.label
  });
}

async function nextQuestion() {
  const q = getActiveQuestion();
  if (!q) {
    await finishInterview();
    return;
  }

  shouldListen = false;
  await botSay(q.prompt);
  shouldListen = true;
  startListening();
}

async function handleUserSpeech(transcript) {
  const q = getActiveQuestion();
  if (!q) return;

  isProcessingTurn = true;
  shouldListen = false;
  setStatus('Processing your answer...');

  try {
    const result = await interpretTurn(transcript, q);

    if (result.intent === 'help') {
      const helpPrompt = result.helpRequest || transcript;
      const reply = await askClarification(helpPrompt, q.prompt);
      await botSay(reply);
      await botSay(`Please answer: ${q.prompt}`);
      return;
    }

    if (result.intent === 'unclear') {
      await botSay(`I did not get a clear answer. Please answer again: ${q.prompt}`);
      return;
    }

    const cleaned = (result.cleanedAnswer || transcript).trim();
    storeAnswer(cleaned);
    await nextQuestion();
  } catch (error) {
    await botSay(`${error.message} Please answer again.`);
  } finally {
    isProcessingTurn = false;
    if (interviewStarted && getActiveQuestion()) {
      shouldListen = true;
      startListening();
    }
  }
}

async function finishInterview() {
  summarySection.classList.remove('hidden');
  setStatus('Interview complete. You can now download the PDF.');
  await botSay('Thank you. I have recorded all your answers. You may now download your print-ready PDF.');
}

function ensureJsPdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('PDF library failed to load. Please check your internet connection and refresh the page.');
  }
  return window.jspdf.jsPDF;
}

function buildPdf() {
  const JsPDF = ensureJsPdf();
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const margin = 15;
  const lineHeight = 7;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Personal Information Interview Summary', margin, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y);
  y += 10;

  questions.forEach((q, index) => {
    const answer = answers[q.key] || 'N/A';
    const row = `${index + 1}. ${q.label}: ${answer}`;
    const lines = doc.splitTextToSize(row, 180);

    if (y + lines.length * lineHeight > pageHeight - margin) {
      doc.addPage();
      y = 20;
    }

    doc.text(lines, margin, y);
    y += lines.length * lineHeight;
  });

  y += 8;
  if (y > pageHeight - margin) {
    doc.addPage();
    y = 20;
  }

  doc.setFont('helvetica', 'italic');
  doc.text('This document is system-generated and ready for printing.', margin, y);

  const filePart = [answers.surname, answers.firstName].filter(Boolean).join('_').replace(/\s+/g, '_');
  const fileName = filePart ? `Interview_${filePart}.pdf` : 'Interview_Record.pdf';
  doc.save(fileName);
}

if ('speechSynthesis' in window && typeof window.speechSynthesis.addEventListener === 'function') {
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    pickPreferredVoice();
    updateSpeakToggle();
  });
}

pickPreferredVoice();
updateSpeakToggle();

if (recognition) {
  recognition.onresult = async (event) => {
    const transcript = (event.results?.[0]?.[0]?.transcript || '').trim();
    isListening = false;
    if (!transcript || isProcessingTurn) {
      return;
    }

    addMessage(transcript, 'user');
    await handleUserSpeech(transcript);
  };

  recognition.onerror = async () => {
    isListening = false;
    if (!isProcessingTurn && interviewStarted) {
      await botSay('I could not hear that clearly. Please speak again.');
      shouldListen = true;
      startListening();
    }
  };

  recognition.onend = () => {
    isListening = false;
    if (interviewStarted && shouldListen && !isProcessingTurn && getActiveQuestion()) {
      setTimeout(() => {
        startListening();
      }, 250);
    }
  };
}

startVoiceBtn.addEventListener('click', async () => {
  if (interviewStarted) return;
  if (!recognition) {
    await botSay('Voice recognition is not supported in this browser. Please use Chrome or Edge.');
    return;
  }

  interviewStarted = true;
  startVoiceBtn.disabled = true;
  setStatus('Voice interview started.');
  await botSay('Voice interview started. If you need help, say help and your question.');
  await nextQuestion();
});

speakToggleBtn.addEventListener('click', () => {
  if (!('speechSynthesis' in window)) {
    updateSpeakToggle();
    return;
  }

  speechEnabled = !speechEnabled;
  if (!speechEnabled) {
    window.speechSynthesis.cancel();
  } else {
    pickPreferredVoice();
  }
  updateSpeakToggle();
});

downloadPdfBtn.addEventListener('click', () => {
  try {
    buildPdf();
  } catch (error) {
    addMessage(error.message, 'bot');
  }
});

addMessage('Press Start Voice Interview to begin. AI voice is off by default until you turn it on.', 'bot');

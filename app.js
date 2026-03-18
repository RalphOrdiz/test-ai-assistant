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

const questionAliases = {
  surname: ['surname', 'last name', 'family name'],
  firstName: ['first name', 'given name', 'firstname'],
  middleName: ['middle name', 'middlename'],
  address: ['address', 'residential address', 'home address'],
  citizenship: ['citizenship', 'nationality'],
  sex: ['sex', 'gender'],
  placeOfBirth: ['place of birth', 'birthplace'],
  dateOfBirth: ['date of birth', 'birth date', 'birthday'],
  height: ['height', 'how tall'],
  weight: ['weight', 'how heavy'],
  civilStatus: ['civil status', 'marital status'],
  profession: ['profession', 'occupation', 'business', 'job', 'work'],
  hasTin: ['tin', 'tin number', 'tax identification number', 'tax number'],
  tinNumber: ['tin number', 'tax identification number', 'tax number']
};

const answers = {};
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
const FORM_TEMPLATE_PATH = '/assets/forms/community-tax-certificate-2000.template.json';

let step = 0;
let interviewStarted = false;
let isListening = false;
let isProcessingTurn = false;
let shouldListen = false;
let speechEnabled = false;
let preferredVoice = null;
let formTemplatePromise = null;
let formBackgroundPromise = null;

if (recognition) {
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseWords(value) {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]+$/.test(word) && (word.length <= 3 || /\d/.test(word))) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
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
    const question = questions[step];
    if (question.conditional && !question.conditional(answers)) {
      answers[question.key] = 'N/A';
      step += 1;
      continue;
    }
    return question;
  }
  return null;
}

function findQuestionIndexByReference(value) {
  const cleaned = normalizeWhitespace(value).toLowerCase();
  if (!cleaned) return -1;

  return questions.findIndex((question) => {
    const aliases = questionAliases[question.key] || [];
    return aliases.some((alias) => cleaned.includes(alias));
  });
}

function isExplicitFieldAssignment(value, questionKey) {
  const cleaned = normalizeWhitespace(value).toLowerCase();
  const aliases = questionAliases[questionKey] || [];

  return aliases.some((alias) => {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`\\bmy\\s+${escapedAlias}\\s+(is|would be|to)\\b`),
      new RegExp(`\\b${escapedAlias}\\s+(is|would be|to)\\b`),
      new RegExp(`\\b(change|correct|update|fix)\\s+my\\s+${escapedAlias}\\b`),
      new RegExp(`\\bfor\\s+my\\s+${escapedAlias}\\b`)
    ];

    return patterns.some((pattern) => pattern.test(cleaned));
  });
}

function findDirectCorrectionTarget(value, currentQuestionKey) {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return -1;

  return questions.findIndex((question, index) => {
    if (question.key === currentQuestionKey) return false;
    if (index >= step) return false;
    return isExplicitFieldAssignment(cleaned, question.key);
  });
}

function parseNavigationCommand(value) {
  const cleaned = normalizeWhitespace(value).toLowerCase();
  if (!cleaned) return null;

  const targetIndex = findQuestionIndexByReference(cleaned);
  const wantsPreviousQuestion =
    cleaned === 'back' ||
    /\b(go back|previous question|back one|previous one|question before|go to the previous question)\b/.test(cleaned);
  const wantsNamedQuestion =
    /\b(go back to|back to|return to|go to|change|correct|edit|update|fix|revise)\b/.test(cleaned) && targetIndex >= 0;

  if (wantsNamedQuestion) {
    return { index: targetIndex };
  }

  if (wantsPreviousQuestion) {
    return { index: step - 1 };
  }

  return null;
}

function rewindToQuestion(targetIndex) {
  const boundedIndex = Math.max(0, Math.min(targetIndex, questions.length - 1));
  for (let index = boundedIndex; index < questions.length; index += 1) {
    delete answers[questions[index].key];
  }
  step = boundedIndex;
}

function normalizeStoredAnswer(questionKey, value) {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return cleaned;

  switch (questionKey) {
    case 'hasTin':
      return /^y(es)?$/i.test(cleaned) ? 'Yes' : /^n(o)?$/i.test(cleaned) ? 'No' : cleaned;
    case 'sex':
      if (/\bmale\b|\bman\b|\bboy\b|\bm\b/i.test(cleaned)) return 'Male';
      if (/\bfemale\b|\bwoman\b|\bgirl\b|\bf\b/i.test(cleaned)) return 'Female';
      return cleaned;
    case 'civilStatus':
      return titleCaseWords(cleaned);
    case 'middleName':
      return /\b(none|not applicable|n\/a)\b/i.test(cleaned) ? 'None' : titleCaseWords(cleaned);
    case 'surname':
    case 'firstName':
    case 'citizenship':
    case 'placeOfBirth':
    case 'profession':
      return titleCaseWords(cleaned);
    default:
      return cleaned;
  }
}

function applyDependentAnswerCleanup(questionKey) {
  if (questionKey === 'hasTin' && !/^y(es)?$/i.test(answers.hasTin || '')) {
    answers.tinNumber = 'N/A';
  }
}

function storeAnswerForKey(questionKey, raw, options = {}) {
  answers[questionKey] = normalizeStoredAnswer(questionKey, raw);
  applyDependentAnswerCleanup(questionKey);

  if (options.advanceStep) {
    step += 1;
  }
}

function storeAnswer(raw) {
  const question = getActiveQuestion();
  if (!question) return;

  storeAnswerForKey(question.key, raw, { advanceStep: true });
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
  const question = getActiveQuestion();
  if (!question) return;

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
    fieldLabel: getActiveQuestion()?.label || '',
    fieldKey: getActiveQuestion()?.key || '',
    collectedAnswers: answers
  });

  return data.reply || 'Please answer in your own words.';
}

async function interpretTurn(userSpeech, question) {
  return postJson('/api/interpret-turn', {
    userSpeech,
    currentQuestion: question.prompt,
    fieldLabel: question.label,
    fieldKey: question.key,
    collectedAnswers: answers
  });
}

async function nextQuestion() {
  const question = getActiveQuestion();
  if (!question) {
    await finishInterview();
    return;
  }

  shouldListen = false;
  await botSay(question.prompt);
  shouldListen = true;
  startListening();
}

async function handleUserSpeech(transcript) {
  const question = getActiveQuestion();
  if (!question) return;

  isProcessingTurn = true;
  shouldListen = false;
  setStatus('Processing your answer...');

  try {
    const navigation = parseNavigationCommand(transcript);
    if (navigation) {
      if (navigation.index < 0) {
        await botSay('You are already at the first question.');
        await nextQuestion();
        return;
      }

      if (navigation.index > step) {
        await botSay(`We are not past ${questions[navigation.index].label} yet.`);
        await nextQuestion();
        return;
      }

      rewindToQuestion(navigation.index);
      await botSay(`Okay. Let's go back to ${questions[navigation.index].label}. I cleared the later answers so you can update them.`);
      await nextQuestion();
      return;
    }

    const directCorrectionTarget = findDirectCorrectionTarget(transcript, question.key);
    if (directCorrectionTarget >= 0) {
      const targetQuestion = questions[directCorrectionTarget];
      const correctionResult = await interpretTurn(transcript, targetQuestion);

      if (correctionResult.intent === 'answer' && correctionResult.cleanedAnswer) {
        storeAnswerForKey(targetQuestion.key, correctionResult.cleanedAnswer, { advanceStep: false });
        await botSay(`Okay. I updated your ${targetQuestion.label} to ${answers[targetQuestion.key]}.`);
        await botSay(`Now, ${question.prompt}`);
        shouldListen = true;
        startListening();
        return;
      }

      if (correctionResult.verification?.message) {
        await botSay(correctionResult.verification.message);
      } else {
        await botSay(`I heard that as a correction for ${targetQuestion.label}, but I still need a clearer answer.`);
      }
      shouldListen = true;
      startListening();
      return;
    }

    const result = await interpretTurn(transcript, question);

    if (result.intent === 'help') {
      const helpPrompt = result.helpRequest || transcript;
      const reply = await askClarification(helpPrompt, question.prompt);
      await botSay(reply);
      await botSay(`Please answer: ${question.prompt}`);
      shouldListen = true;
      startListening();
      return;
    }

    if (result.intent === 'unclear') {
      if (result.verification?.message) {
        await botSay(result.verification.message);
        await botSay(`Please answer again: ${question.prompt}`);
      } else {
        await botSay(`I did not get a clear answer for ${question.label}. Please answer again: ${question.prompt}`);
      }
      shouldListen = true;
      startListening();
      return;
    }

    const cleaned = (result.cleanedAnswer || transcript).trim();
    storeAnswer(cleaned);
    await nextQuestion();
  } catch (error) {
    await botSay(`${error.message} Please answer again.`);
    await nextQuestion();
  } finally {
    isProcessingTurn = false;
    if (interviewStarted && shouldListen && !isListening && getActiveQuestion()) {
      startListening();
    }
  }
}

async function finishInterview() {
  shouldListen = false;
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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}.`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}.`);
  }
  return response.text();
}

function loadFormTemplate() {
  if (!formTemplatePromise) {
    formTemplatePromise = fetchJson(FORM_TEMPLATE_PATH).catch((error) => {
      formTemplatePromise = null;
      throw error;
    });
  }
  return formTemplatePromise;
}

function svgMarkupToDataUrl(svgMarkup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load the form background image.'));
    image.src = src;
  });
}

async function svgToPngDataUrl(svgMarkup, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is not available in this browser.');
  }

  const image = await loadImage(svgMarkupToDataUrl(svgMarkup));
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

async function loadFormBackground(template) {
  if (!formBackgroundPromise) {
    formBackgroundPromise = fetchText(template.background)
      .then((svgMarkup) => svgToPngDataUrl(svgMarkup, template.page.width, template.page.height))
      .catch((error) => {
        formBackgroundPromise = null;
        throw error;
      });
  }
  return formBackgroundPromise;
}

function getFormFieldValue(fieldKey) {
  const raw = normalizeWhitespace(answers[fieldKey]);
  if (!raw || /^n\/a$/i.test(raw)) return '';
  if (fieldKey === 'middleName' && /^none$/i.test(raw)) return '';
  if (fieldKey === 'tinNumber' && !/^y(es)?$/i.test(answers.hasTin || '')) return '';
  return raw;
}

function fitTextToWidth(doc, text, width, startingFontSize) {
  let fontSize = startingFontSize;
  let output = text;

  doc.setFontSize(fontSize);
  while (fontSize > 8 && doc.getTextWidth(output) > width) {
    fontSize -= 0.5;
    doc.setFontSize(fontSize);
  }

  if (doc.getTextWidth(output) <= width) {
    return { fontSize, text: output };
  }

  while (output.length > 1 && doc.getTextWidth(`${output}...`) > width) {
    output = output.slice(0, -1);
  }

  return { fontSize, text: `${output}...` };
}

function drawTextField(doc, fieldKey, field) {
  const rawValue = getFormFieldValue(fieldKey);
  if (!rawValue) return;

  const prepared = field.uppercase ? rawValue.toUpperCase() : rawValue;
  doc.setFont('helvetica', 'normal');

  const fitted = fitTextToWidth(doc, prepared, field.w, field.fontSize || 14);
  doc.setFontSize(fitted.fontSize);

  const baselineY = field.y + field.h - Math.max(4, field.h * 0.18);
  doc.text(fitted.text, field.x, baselineY);
}

function drawBoxesField(doc, fieldKey, field) {
  const rawValue = getFormFieldValue(fieldKey);
  if (!rawValue) return;

  const prepared = field.sanitize === 'digits' ? rawValue.replace(/\D/g, '') : rawValue;
  if (!prepared) return;

  doc.setFont('courier', 'bold');
  doc.setFontSize(field.fontSize || 16);

  field.cells.forEach((cell, index) => {
    const character = prepared[index];
    if (!character) return;

    const x = cell.x + cell.w / 2;
    const y = cell.y + cell.h / 2 + (field.fontSize || 16) * 0.32;
    doc.text(character, x, y, { align: 'center' });
  });
}

function normalizeChoiceValue(fieldKey, value) {
  const cleaned = normalizeWhitespace(value).toLowerCase();
  if (!cleaned) return '';

  if (fieldKey === 'sex') {
    if (cleaned.startsWith('m')) return 'Male';
    if (cleaned.startsWith('f')) return 'Female';
  }

  if (fieldKey === 'civilStatus') {
    if (cleaned.includes('single')) return 'Single';
    if (cleaned.includes('married')) return 'Married';
    if (cleaned.includes('widow')) return 'Widowed';
    if (cleaned.includes('legally separated') || cleaned.includes('legal separated') || cleaned.includes('separated')) {
      return 'Legally Separated';
    }
    if (cleaned.includes('divorc')) return 'Divorced';
  }

  return value;
}

function drawChoiceField(doc, fieldKey, field) {
  const normalizedValue = normalizeChoiceValue(fieldKey, getFormFieldValue(fieldKey));
  if (!normalizedValue) return;

  const option = field.options[normalizedValue];
  if (!option) return;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(option.size || 16);

  if (option.box) {
    const centerX = option.box.x + option.box.w / 2;
    const centerY = option.box.y + option.box.h / 2;
    doc.text(option.mark || 'X', centerX, centerY, { align: 'center', baseline: 'middle' });
    return;
  }

  doc.text(option.mark || 'X', option.x, option.y + (option.size || 16) - 2);
}

function renderFormFields(doc, template) {
  Object.entries(template.fields).forEach(([fieldKey, field]) => {
    if (field.type === 'text') {
      drawTextField(doc, fieldKey, field);
      return;
    }

    if (field.type === 'boxes') {
      drawBoxesField(doc, fieldKey, field);
      return;
    }

    if (field.type === 'choice') {
      drawChoiceField(doc, fieldKey, field);
    }
  });
}

function buildDownloadFileName() {
  const filePart = [answers.surname, answers.firstName]
    .filter(Boolean)
    .join('_')
    .replace(/\s+/g, '_');
  return filePart ? `Interview_${filePart}.pdf` : 'Interview_Record.pdf';
}

async function buildPdf() {
  const JsPDF = ensureJsPdf();
  const template = await loadFormTemplate();
  const orientation = template.page.width >= template.page.height ? 'landscape' : 'portrait';
  const doc = new JsPDF({
    orientation,
    unit: 'px',
    format: [template.page.width, template.page.height],
    compress: true
  });
  const backgroundDataUrl = await loadFormBackground(template);

  doc.setProperties({
    title: template.title,
    subject: 'Interview answers mapped to a Community Tax Certificate form',
    creator: 'Capstone AI Interview Assistant'
  });

  doc.addImage(backgroundDataUrl, 'PNG', 0, 0, template.page.width, template.page.height);
  doc.setTextColor(15, 15, 15);
  renderFormFields(doc, template);

  doc.save(buildDownloadFileName());
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
    let heardText = '';
    let finalText = '';

    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcriptPart = normalizeWhitespace(result?.[0]?.transcript || '');
      if (!transcriptPart) continue;

      heardText = normalizeWhitespace(`${heardText} ${transcriptPart}`);
      if (result.isFinal) {
        finalText = normalizeWhitespace(`${finalText} ${transcriptPart}`);
      }
    }

    if (heardText) {
      setStatus(`Picked up: ${heardText}`);
    }

    if (!finalText || isProcessingTurn) {
      return;
    }

    isListening = false;
    addMessage(finalText, 'user');
    await handleUserSpeech(finalText);
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
  await botSay('Voice interview started. If you need help, say help and your question. If you want to correct an earlier answer, say go back or say the field you want to change.');
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

downloadPdfBtn.addEventListener('click', async () => {
  downloadPdfBtn.disabled = true;
  try {
    await buildPdf();
  } catch (error) {
    addMessage(error.message, 'bot');
  } finally {
    downloadPdfBtn.disabled = false;
  }
});

addMessage('Press Start Voice Interview to begin. You can say go back anytime to return to an earlier question.', 'bot');

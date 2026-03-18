require('dotenv').config();
const path = require('path');
const express = require('express');

const app = express();
const port = Number(process.env.PORT || 3000);
const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/+$/, '');
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const ollamaApiKey = process.env.OLLAMA_API_KEY || '';

const FIELD_RULES = {
  surname:
    'Return only the surname. Remove phrases like "my surname is". Preserve suffixes only if clearly part of the surname.',
  firstName:
    'Return only the first name or given names the user wants recorded. Remove introductions and filler phrases.',
  middleName:
    'Return only the middle name. If the user says none, no middle name, not applicable, or N/A, return "None".',
  address:
    'Return only the residential address. Keep street, barangay, city, province, and postal code if spoken.',
  citizenship:
    'Return only the citizenship or nationality, such as "Filipino".',
  sex:
    'Return only "Male" or "Female" when possible.',
  placeOfBirth:
    'Return only the place of birth, keeping city, province, and country if spoken.',
  dateOfBirth:
    'Return only the date of birth. If the spoken date is clear and includes a named month, normalize to "Month DD, YYYY".',
  height:
    'Return only the height and unit, such as "170 cm" or "5 ft 7 in".',
  weight:
    'Return only the weight and unit, such as "65 kg" or "143 lb".',
  civilStatus:
    'Return one of these values when possible: Single, Married, Widowed, Legally Separated, Divorced.',
  profession:
    'Return only the profession, occupation, or business description.',
  hasTin:
    'Return only "Yes" or "No".',
  tinNumber:
    'Return only the TIN number, preserving digits and hyphens.'
};

const MONTH_PATTERN =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const HELP_PATTERN =
  /\b(help|explain|clarify|meaning|what does that mean|what do you mean|how do i answer|how should i answer|can you repeat|repeat the question|i do not understand|i'm confused|example)\b/i;
const YES_PATTERN = /\b(yes|yeah|yep|affirmative|correct|i do|i have|meron|opo)\b/i;
const NO_PATTERN = /\b(no|nope|negative|i do not|i don't|wala|none|nah|hindi)\b/i;
const SMALL_NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19
};
const TENS_NUMBER_WORDS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};
const SCALE_NUMBER_WORDS = {
  hundred: 100,
  thousand: 1000
};

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

async function runChat(messages, maxTokens = 280) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (ollamaApiKey) {
    headers.Authorization = `Bearer ${ollamaApiKey}`;
  }

  const response = await fetch(`${ollamaBaseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: ollamaModel,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error?.message || data.error || response.statusText || 'Unknown Ollama error';
    throw new Error(detail);
  }

  return (data.choices?.[0]?.message?.content || '').trim();
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

function expandNumberWordToken(token) {
  const compact = token.toLowerCase().replace(/[^a-z-]/g, '');
  if (!compact) return [];
  return compact.split('-').filter(Boolean);
}

function parseNumberWordSequence(rawTokens) {
  let total = 0;
  let current = 0;
  let consumed = 0;
  let sawNumber = false;

  for (const rawToken of rawTokens) {
    const parts = expandNumberWordToken(rawToken);
    if (!parts.length) break;

    let tokenConsumed = false;

    for (const part of parts) {
      if (part === 'and' && sawNumber) {
        tokenConsumed = true;
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(SMALL_NUMBER_WORDS, part)) {
        current += SMALL_NUMBER_WORDS[part];
        sawNumber = true;
        tokenConsumed = true;
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(TENS_NUMBER_WORDS, part)) {
        current += TENS_NUMBER_WORDS[part];
        sawNumber = true;
        tokenConsumed = true;
        continue;
      }

      if (part === 'hundred' && sawNumber) {
        current *= SCALE_NUMBER_WORDS[part];
        tokenConsumed = true;
        continue;
      }

      if (part === 'thousand' && sawNumber) {
        total += current * SCALE_NUMBER_WORDS[part];
        current = 0;
        tokenConsumed = true;
        continue;
      }

      return sawNumber ? { value: total + current, consumed } : null;
    }

    if (!tokenConsumed) {
      break;
    }

    consumed += 1;
  }

  if (!sawNumber || consumed === 0) {
    return null;
  }

  return { value: total + current, consumed };
}

function normalizeSpokenNumbersInText(value) {
  const tokens = normalizeWhitespace(value).split(' ').filter(Boolean);
  const rebuilt = [];

  for (let index = 0; index < tokens.length; ) {
    const parsed = parseNumberWordSequence(tokens.slice(index));
    if (parsed) {
      rebuilt.push(String(parsed.value));
      index += parsed.consumed;
      continue;
    }

    rebuilt.push(tokens[index]);
    index += 1;
  }

  return normalizeWhitespace(rebuilt.join(' '));
}

function normalizeMeasurementText(value) {
  return normalizeWhitespace(
    value
      .replace(/\bcentimeters?\b/gi, 'cm')
      .replace(/\bmeters?\b/gi, 'm')
      .replace(/\bkilograms?\b/gi, 'kg')
      .replace(/\bkilos?\b/gi, 'kg')
      .replace(/\bpounds?\b/gi, 'lb')
      .replace(/\blbs?\b/gi, 'lb')
      .replace(/\bfeet\b/gi, 'ft')
      .replace(/\bfoot\b/gi, 'ft')
      .replace(/\binches?\b/gi, 'in')
  );
}

function stripLeadIn(value, patterns) {
  let result = normalizeWhitespace(value);
  patterns.forEach((pattern) => {
    result = result.replace(pattern, '');
  });
  return normalizeWhitespace(result);
}

function normalizeDateValue(value) {
  const cleaned = stripLeadIn(value, [
    /^(it'?s|it is)\s+/i,
    /^(my|the)\s+date\s+of\s+birth\s+(is|would be)\s+/i,
    /^date\s+of\s+birth\s+(is|would be)\s+/i,
    /^(i was born on|born on)\s+/i
  ]);

  if (!cleaned) return '';
  if (!MONTH_PATTERN.test(cleaned)) {
    return cleaned;
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    return cleaned;
  }

  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: '2-digit'
  });
}

function normalizeCivilStatus(value) {
  const cleaned = normalizeWhitespace(value).toLowerCase();
  if (/legally?\s+separated|separated/.test(cleaned)) return 'Legally Separated';
  if (/widow|widowed/.test(cleaned)) return 'Widowed';
  if (/divorc/.test(cleaned)) return 'Divorced';
  if (/married/.test(cleaned)) return 'Married';
  if (/single|unmarried/.test(cleaned)) return 'Single';
  return titleCaseWords(value);
}

function normalizeYesNo(value) {
  const cleaned = normalizeWhitespace(value).toLowerCase();
  if (['yes', 'yeah', 'yep', 'yah', 'yup', 'correct', 'affirmative', 'opo'].includes(cleaned)) return 'Yes';
  if (['no', 'know', 'nope', 'nah', 'negative', 'wala', 'hindi'].includes(cleaned)) return 'No';
  if (YES_PATTERN.test(value)) return 'Yes';
  if (NO_PATTERN.test(value)) return 'No';
  return '';
}

function normalizeSex(value) {
  const stripped = stripLeadIn(value, [
    /^(my|the)\s+sex\s+(is|would be)\s+/i,
    /^(my|the)\s+gender\s+(is|would be)\s+/i,
    /^sex\s+(is|would be)\s+/i,
    /^gender\s+(is|would be)\s+/i,
    /^(i am|i'm)\s+/i
  ]);
  const cleaned = normalizeWhitespace(stripped).toLowerCase();

  if (['m', 'male', 'mail'].includes(cleaned) || /\bmale\b|\bman\b|\bboy\b/.test(cleaned)) return 'Male';
  if (['f', 'female', 'femail'].includes(cleaned) || /\bfemale\b|\bwoman\b|\bgirl\b/.test(cleaned)) return 'Female';
  return '';
}

function normalizeTinNumber(value) {
  const stripped = stripLeadIn(value, [
    /^(my|the)\s+tin(\s+number)?\s+(is|would be)\s+/i,
    /^tin(\s+number)?\s+(is|would be)\s+/i
  ]);
  return stripped.replace(/[^0-9-]/g, '');
}

function normalizeFreeText(value, patterns = []) {
  return stripLeadIn(value, patterns)
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.');
}

function normalizeFieldValue(fieldKey, value) {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return '';
  const numberAwareValue = normalizeSpokenNumbersInText(cleaned);

  switch (fieldKey) {
    case 'surname':
      return titleCaseWords(
        normalizeFreeText(cleaned, [
          /^(my|the)\s+surname\s+(is|would be)\s+/i,
          /^surname\s+(is|would be)\s+/i,
          /^(i am|i'm)\s+/i
        ])
      );
    case 'firstName':
      return titleCaseWords(
        normalizeFreeText(cleaned, [
          /^(my|the)\s+first\s+name\s+(is|would be)\s+/i,
          /^(my|the)\s+given\s+name\s+(is|would be)\s+/i,
          /^first\s+name\s+(is|would be)\s+/i,
          /^name\s+(is|would be)\s+/i,
          /^(i am|i'm)\s+/i
        ])
      );
    case 'middleName':
      if (/\b(none|no middle name|not applicable|n\/a|na)\b/i.test(cleaned)) return 'None';
      return titleCaseWords(
        normalizeFreeText(cleaned, [/^(my|the)\s+middle\s+name\s+(is|would be)\s+/i, /^middle\s+name\s+(is|would be)\s+/i])
      );
    case 'address':
      return normalizeFreeText(cleaned, [
        /^(my|the)\s+(complete\s+)?(residential\s+)?address\s+(is|would be)\s+/i,
        /^address\s+(is|would be)\s+/i,
        /^(i live at|we live at|i stay at|residing at)\s+/i
      ]);
    case 'citizenship':
      return titleCaseWords(
        normalizeFreeText(cleaned, [
          /^(my|the)\s+citizenship\s+(is|would be)\s+/i,
          /^citizenship\s+(is|would be)\s+/i,
          /^(i am)\s+/i
        ])
      );
    case 'sex':
      return normalizeSex(cleaned);
    case 'placeOfBirth':
      return titleCaseWords(
        normalizeFreeText(cleaned, [
          /^(my|the)\s+place\s+of\s+birth\s+(is|would be)\s+/i,
          /^place\s+of\s+birth\s+(is|would be)\s+/i,
          /^(i was born in|i was born at|born in|born at)\s+/i
        ])
      );
    case 'dateOfBirth':
      return normalizeDateValue(numberAwareValue);
    case 'height':
      return normalizeMeasurementText(
        normalizeFreeText(numberAwareValue, [
        /^(my|the)\s+height\s+(is|would be)\s+/i,
        /^height\s+(is|would be)\s+/i,
        /^(i am|i'm)\s+/i
        ]).replace(/\s+tall$/i, '')
      );
    case 'weight':
      return normalizeMeasurementText(
        normalizeFreeText(numberAwareValue, [
        /^(my|the)\s+weight\s+(is|would be)\s+/i,
        /^weight\s+(is|would be)\s+/i,
        /^(i weigh)\s+/i
        ])
      );
    case 'civilStatus':
      return normalizeCivilStatus(cleaned);
    case 'profession':
      return titleCaseWords(
        normalizeFreeText(cleaned, [
          /^(my|the)\s+(profession|occupation|business)\s+(is|would be)\s+/i,
          /^i work as\s+/i,
          /^i am a\s+/i,
          /^i am an\s+/i,
          /^i'm a\s+/i,
          /^i'm an\s+/i,
          /^profession\s+(is|would be)\s+/i,
          /^occupation\s+(is|would be)\s+/i
        ])
      );
    case 'hasTin':
      return normalizeYesNo(cleaned);
    case 'tinNumber':
      return normalizeTinNumber(cleaned);
    default:
      return cleaned;
  }
}

function extractJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const direct = raw.replace(/```json|```/gi, '').trim();
  try {
    return JSON.parse(direct);
  } catch (_error) {
    const match = direct.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_nestedError) {
      return null;
    }
  }
}

function buildFallbackInterpretation(userSpeech, fieldKey) {
  const trimmed = normalizeWhitespace(userSpeech);
  if (!trimmed) {
    return { intent: 'unclear', cleanedAnswer: '', helpRequest: '' };
  }

  if (HELP_PATTERN.test(trimmed)) {
    return { intent: 'help', cleanedAnswer: '', helpRequest: trimmed };
  }

  if (/^(uh|um|hmm|wait|sorry|hello|hi)$/i.test(trimmed)) {
    return { intent: 'unclear', cleanedAnswer: '', helpRequest: '' };
  }

  const cleanedAnswer = normalizeFieldValue(fieldKey, trimmed);
  if (!cleanedAnswer) {
    return { intent: 'unclear', cleanedAnswer: '', helpRequest: '' };
  }

  return { intent: 'answer', cleanedAnswer, helpRequest: '' };
}

function verifyFieldAnswer(fieldKey, answer) {
  const cleaned = normalizeWhitespace(answer);
  if (!cleaned) {
    return { status: 'invalid', message: 'I need a clearer answer for this field.' };
  }

  switch (fieldKey) {
    case 'hasTin':
      if (!['Yes', 'No'].includes(cleaned)) {
        return { status: 'invalid', message: 'Please answer yes or no.' };
      }
      break;
    case 'sex':
      if (!['Male', 'Female'].includes(cleaned)) {
        return { status: 'invalid', message: 'Please answer male or female.' };
      }
      break;
    case 'civilStatus':
      if (!['Single', 'Married', 'Widowed', 'Legally Separated', 'Divorced'].includes(cleaned)) {
        return { status: 'invalid', message: 'Please answer with a clear civil status.' };
      }
      break;
    case 'tinNumber':
      if ((cleaned.match(/\d/g) || []).length < 3) {
        return { status: 'invalid', message: 'That TIN number sounds incomplete.' };
      }
      break;
    case 'height':
      if (!/^(\d{2,3}(\.\d+)?\s*cm|\d(\.\d+)?\s*m|\d\s*ft(\s+\d{1,2}\s*in)?)$/i.test(cleaned) && !/^\d{2,3}(\.\d+)?$/i.test(cleaned)) {
        return { status: 'invalid', message: 'That is not a valid height. Please say a number, such as 170 centimeters or 5 feet 7 inches.' };
      }
      break;
    case 'weight':
      if (!/^(\d{1,3}(\.\d+)?\s*(kg|lb))$/i.test(cleaned) && !/^\d{1,3}(\.\d+)?$/i.test(cleaned)) {
        return { status: 'invalid', message: 'That is not a valid weight. Please say a number, such as 65 kilograms or 143 pounds.' };
      }
      break;
    case 'dateOfBirth':
      if (
        !(
          /\b\d{4}\b/.test(cleaned) ||
          /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(cleaned) ||
          /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(cleaned) ||
          (MONTH_PATTERN.test(cleaned) && /\d/.test(cleaned))
        )
      ) {
        return { status: 'invalid', message: 'That is not a valid date of birth. Please say it like March 18, 2004.' };
      }
      break;
    case 'address':
      if (cleaned.length < 8 || !/[a-z]/i.test(cleaned)) {
        return { status: 'invalid', message: 'That does not sound like a full address. Please include enough detail, such as street, barangay, city, or province.' };
      }
      break;
    case 'surname':
    case 'firstName':
    case 'middleName':
      if (/\d/.test(cleaned)) {
        return { status: 'invalid', message: `That does not sound like a valid ${fieldKey}. Please say the name only.` };
      }
      break;
    case 'citizenship':
      if (/\d/.test(cleaned) || ['Yes', 'No'].includes(cleaned)) {
        return { status: 'invalid', message: 'That is not a valid citizenship. Please answer with a nationality, such as Filipino.' };
      }
      break;
    case 'profession':
      if (['Yes', 'No'].includes(cleaned)) {
        return { status: 'invalid', message: 'That is not a valid profession. Please say your job, occupation, or business.' };
      }
      break;
    default:
      if (['Yes', 'No'].includes(cleaned)) {
        return { status: 'invalid', message: `That does not sound like a valid ${fieldKey} answer.` };
      }
      if (cleaned.length < 2) {
        return { status: 'invalid', message: 'That answer sounds incomplete.' };
      }
      break;
  }

  return { status: 'verified', message: '' };
}

function buildFastInterpretation(userSpeech, fieldKey) {
  const quick = buildFallbackInterpretation(userSpeech, fieldKey);
  if (quick.intent !== 'answer') {
    return {
      intent: quick.intent,
      cleanedAnswer: quick.cleanedAnswer,
      helpRequest: quick.helpRequest,
      verification: null
    };
  }

  const verification = verifyFieldAnswer(fieldKey, quick.cleanedAnswer);
  if (verification.status === 'invalid') {
    return {
      intent: 'unclear',
      cleanedAnswer: '',
      helpRequest: '',
      verification
    };
  }

  return {
    intent: 'answer',
    cleanedAnswer: quick.cleanedAnswer,
    helpRequest: '',
    verification
  };
}

app.post('/api/clarify', async (req, res) => {
  try {
    const { message, currentQuestion, collectedAnswers, fieldLabel, fieldKey } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'A clarification message is required.' });
    }

    const reply = await runChat(
      [
        {
          role: 'system',
          content:
            'You are an AI assistant helping a user answer an official personal information interview form. Explain the current field in plain language, define what kind of answer is valid, and give one concrete example when useful. Keep the reply concise, precise, and intelligent for voice playback. Do not invent legal requirements. If the user asks unrelated things, gently steer back to the current question.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            userConcern: message,
            currentInterviewQuestion: currentQuestion,
            currentFieldLabel: fieldLabel || '',
            currentFieldKey: fieldKey || '',
            collectedAnswers
          })
        }
      ],
      220
    );

    if (!reply) {
      return res.status(502).json({ error: 'Ollama returned an empty response.' });
    }

    return res.json({ reply });
  } catch (error) {
    const detail = error && error.message ? error.message : 'Unknown server error';
    return res.status(500).json({ error: `AI request failed: ${detail}` });
  }
});

app.post('/api/interpret-turn', async (req, res) => {
  try {
    const { userSpeech, currentQuestion, fieldLabel, fieldKey, collectedAnswers } = req.body || {};
    if (!userSpeech || typeof userSpeech !== 'string') {
      return res.status(400).json({ error: 'userSpeech is required.' });
    }

    const normalizedFieldKey = typeof fieldKey === 'string' ? fieldKey : '';
    const fieldRule = FIELD_RULES[normalizedFieldKey] || 'Return only the final field value with no extra commentary.';
    const fastInterpretation = buildFastInterpretation(userSpeech, normalizedFieldKey);

    if (fastInterpretation.intent === 'help' || fastInterpretation.intent === 'answer') {
      return res.json(fastInterpretation);
    }

    const raw = await runChat(
      [
        {
          role: 'system',
          content:
            `You extract structured meaning from spoken interview answers. Return ONLY minified JSON with keys "intent", "cleanedAnswer", and "helpRequest".
"intent" must be exactly one of "answer", "help", or "unclear".
"cleanedAnswer" must contain only the value to store for the current field. No labels. No full sentence.
"helpRequest" is only used when intent="help".
Use the field rule strictly: ${fieldRule}
Treat filler phrases like "my answer is", "I think", "uh", and "please put" as noise.
If the user asks what a question means or how to answer, set intent="help".
If the speech does not contain a usable answer for this field, set intent="unclear".
For yes/no fields, normalize to "Yes" or "No".
For middle name with no value, return "None".
For civil status, prefer the official option labels.`
        },
        {
          role: 'user',
          content: JSON.stringify({
            userSpeech,
            currentQuestion,
            fieldLabel,
            fieldKey: normalizedFieldKey,
            collectedAnswers
          })
        }
      ],
      96
    );

    const parsed = extractJsonObject(raw) || {};
    const fallback = buildFallbackInterpretation(userSpeech, normalizedFieldKey);

    const intent = ['answer', 'help', 'unclear'].includes(parsed.intent) ? parsed.intent : 'unclear';
    const cleanedAnswer = normalizeFieldValue(
      normalizedFieldKey,
      typeof parsed.cleanedAnswer === 'string' ? parsed.cleanedAnswer.trim() : ''
    );
    const helpRequest = typeof parsed.helpRequest === 'string' ? parsed.helpRequest.trim() : '';

    if (intent === 'help') {
      return res.json({
        intent,
        cleanedAnswer: '',
        helpRequest: helpRequest || fallback.helpRequest,
        verification: null
      });
    }

    if (intent === 'answer' && cleanedAnswer) {
      const verification = verifyFieldAnswer(normalizedFieldKey, cleanedAnswer);
      if (verification.status !== 'invalid') {
        return res.json({
          intent,
          cleanedAnswer,
          helpRequest: '',
          verification
        });
      }
    }

    const fallbackVerification = fallback.intent === 'answer' ? verifyFieldAnswer(normalizedFieldKey, fallback.cleanedAnswer) : null;
    if (fallback.intent === 'answer' && fallbackVerification?.status === 'invalid') {
      return res.json({
        intent: 'unclear',
        cleanedAnswer: '',
        helpRequest: '',
        verification: fallbackVerification
      });
    }

    return res.json({
      intent: fallback.intent,
      cleanedAnswer: fallback.cleanedAnswer,
      helpRequest: fallback.helpRequest,
      verification: fallbackVerification
    });
  } catch (error) {
    const detail = error && error.message ? error.message : 'Unknown server error';
    return res.status(500).json({ error: `Turn interpretation failed: ${detail}` });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function startServer(requestedPort, retries = 10) {
  const server = app.listen(requestedPort, () => {
    console.log(`AI Interview Assistant running at http://localhost:${requestedPort} using Ollama model "${ollamaModel}"`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && retries > 0) {
      const nextPort = requestedPort + 1;
      console.warn(`Port ${requestedPort} is in use. Retrying on ${nextPort}...`);
      startServer(nextPort, retries - 1);
      return;
    }
    throw error;
  });
}

startServer(port);

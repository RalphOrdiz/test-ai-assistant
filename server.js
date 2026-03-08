require('dotenv').config();
const path = require('path');
const express = require('express');

const app = express();
const port = Number(process.env.PORT || 3000);
const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1').replace(/\/+$/, '');
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const ollamaApiKey = process.env.OLLAMA_API_KEY || '';

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
      temperature: 0.3,
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

app.post('/api/clarify', async (req, res) => {
  try {
    const { message, currentQuestion, collectedAnswers } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'A clarification message is required.' });
    }

    const reply = await runChat(
      [
        {
          role: 'system',
          content:
            'You are an AI assistant helping a user answer an official personal information interview form. Explain clearly and simply. Keep answers concise, respectful, and practical. Do not invent legal requirements. If the user asks unrelated things, gently steer back to the current question.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            userConcern: message,
            currentInterviewQuestion: currentQuestion,
            collectedAnswers
          })
        }
      ],
      280
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
    const { userSpeech, currentQuestion, fieldLabel } = req.body || {};
    if (!userSpeech || typeof userSpeech !== 'string') {
      return res.status(400).json({ error: 'userSpeech is required.' });
    }

    const raw = await runChat(
      [
        {
          role: 'system',
          content:
            'Extract interview intent and clean value. Return ONLY valid JSON with keys: intent, cleanedAnswer, helpRequest. intent must be one of answer/help/unclear. cleanedAnswer must contain only the final field value without filler words. Example: input "my name is Ralph John" -> cleanedAnswer "Ralph John". If the user is asking for explanation, set intent=help and put short request in helpRequest.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            userSpeech,
            currentQuestion,
            fieldLabel
          })
        }
      ],
      180
    );

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      return res.json({ intent: 'answer', cleanedAnswer: userSpeech.trim(), helpRequest: '' });
    }

    const intent = ['answer', 'help', 'unclear'].includes(parsed.intent) ? parsed.intent : 'unclear';
    const cleanedAnswer = typeof parsed.cleanedAnswer === 'string' ? parsed.cleanedAnswer.trim() : '';
    const helpRequest = typeof parsed.helpRequest === 'string' ? parsed.helpRequest.trim() : '';

    return res.json({
      intent,
      cleanedAnswer,
      helpRequest
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

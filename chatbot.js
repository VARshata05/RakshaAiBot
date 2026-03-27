// ── Raksha Health Assistant · chatbot.js ──────────────────────────────────────
// Powered by Google Gemini API
// ──────────────────────────────────────────────────────────────────────────────

const API_KEY = (typeof window !== "undefined" && window.RAKSHA_CONFIG && window.RAKSHA_CONFIG.GROQ_API_KEY)
  ? window.RAKSHA_CONFIG.GROQ_API_KEY
  : ((typeof process !== "undefined" && process.env && process.env.GROQ_API_KEY)
    ? process.env.GROQ_API_KEY
    : "");
const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL   = "llama-3.1-8b-instant";

const SYSTEM_PROMPT = `You are Raksha AI, a friendly healthcare assistant.

REPLY STYLE:
- Keep replies short and clear — 3 to 5 lines maximum.
- Use simple everyday language. No medical jargon unless explained.
- Each point on its own line. No long paragraphs.
- Always directly answer what was asked. No filler phrases.
- Remember the full conversation and refer to it naturally.

FOR SYMPTOMS:
- Briefly explain what the symptom may indicate.
- Always mention the right specialist to consult (e.g. Cardiologist, Dermatologist, ENT, Orthopedic, Neurologist, Gastroenterologist, Endocrinologist, General Physician etc.) based on the symptom or body system.
- If serious or emergency, say "Please go to emergency immediately." first.

FOR REPORTS:
- State what type of report it is.
- List abnormal values clearly and what they mean in simple words.
- Name the specialist to consult based on the abnormal findings.

RULES:
- Never diagnose. Never prescribe doses.
- For hospital searches: "Use the hospital finder on this website."
- Be warm, honest, and reassuring.`;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chatbox          = document.getElementById("chatbox");
const userInput        = document.getElementById("userInput");
const sendBtn          = document.getElementById("sendBtn");
const fileBtn          = document.getElementById("fileBtn");
const photoBtn         = document.getElementById("photoBtn");
const fileUploadInput  = document.getElementById("fileUploadInput");
const photoUploadInput = document.getElementById("photoUploadInput");
const liveStatusBadge  = document.getElementById("liveStatusBadge");
const liveStatusText   = document.getElementById("liveStatusText");

let uploadedReportContext = null;
let userName = "";
let conversationHistory = []; // stores full chat for context

// ── Status badge ──────────────────────────────────────────────────────────────
function setLiveStatus(state, text) {
  if (!liveStatusBadge || !liveStatusText) return;
  liveStatusBadge.className = "status-badge status-" + state;
  liveStatusBadge.textContent =
    state === "online"   ? "Live AI online" :
    state === "thinking" ? "Thinking..."    : "Assistant ready";
  liveStatusText.textContent = text;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanText(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function toNameCase(name) {
  return cleanText(name)
    .split(" ").filter(Boolean)
    .map(function(p) { return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); })
    .join(" ");
}

function extractIntroducedName(message) {
  var match = cleanText(message)
    .match(/(?:^|\b)(?:i am|i'm|my name is)\s+([a-z][a-z\s'-]{1,30})$/i);
  if (!match) return "";
  var raw = cleanText(match[1]).replace(/[^a-z\s'-]/gi, "");
  return raw ? toNameCase(raw) : "";
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Chat UI ───────────────────────────────────────────────────────────────────
function appendMessage(author, text, type) {
  var wrapper = document.createElement("div");
  wrapper.className = "message " + type;

  var title = document.createElement("div");
  title.className = "message-title";
  title.textContent = author;

  var body = document.createElement("div");
  body.className = "message-text";
  body.textContent = stripMarkdown(text);

  wrapper.appendChild(title);
  wrapper.appendChild(body);
  chatbox.appendChild(wrapper);
  chatbox.scrollTop = chatbox.scrollHeight;
}

function appendTypingIndicator() {
  var wrapper = document.createElement("div");
  wrapper.className = "message bot typing-indicator-wrapper";
  wrapper.id = "typingIndicator";

  var title = document.createElement("div");
  title.className = "message-title";
  title.textContent = "Bot";

  var body = document.createElement("div");
  body.className = "message-text typing-indicator";
  body.innerHTML = "<span></span><span></span><span></span>";

  wrapper.appendChild(title);
  wrapper.appendChild(body);
  chatbox.appendChild(wrapper);
  chatbox.scrollTop = chatbox.scrollHeight;
}

function removeTypingIndicator() {
  var el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

function appendUploadMessage(file, isPhoto, previewSrc) {
  var wrapper = document.createElement("div");
  wrapper.className = "message user";

  var title = document.createElement("div");
  title.className = "message-title";
  title.textContent = "You";

  var body = document.createElement("div");
  body.className = "message-text";
  var sizeKb = Math.max(1, Math.round(file.size / 1024));
  body.textContent = isPhoto
    ? "Photo uploaded: " + file.name + " (" + sizeKb + " KB)"
    : "File uploaded: " + file.name + " (" + sizeKb + " KB)";

  wrapper.appendChild(title);
  wrapper.appendChild(body);

  if (isPhoto && previewSrc) {
    var preview = document.createElement("img");
    preview.className = "upload-preview";
    preview.src = previewSrc;
    preview.alt = "Uploaded photo preview";
    wrapper.appendChild(preview);
  }

  chatbox.appendChild(wrapper);
  chatbox.scrollTop = chatbox.scrollHeight;
}

// ── Groq API call with conversation history ──────────────────────────────────
async function callGemini(newUserParts) {
  if (!API_KEY) {
    throw new Error("Missing API key. Set GROQ_API_KEY in config.local.js (browser) or process env.");
  }

  // Convert Gemini-style parts to a single text string for Groq
  var userText = "";
  var hasImage = false;
  for (var i = 0; i < newUserParts.length; i++) {
    if (newUserParts[i].text) userText += newUserParts[i].text + " ";
    if (newUserParts[i].inline_data) hasImage = true;
  }
  userText = userText.trim();
  if (hasImage) userText += " [Note: user uploaded an image/file but text extraction was used instead]";

  // Build messages array from history + new message
  var messages = [{ role: "system", content: SYSTEM_PROMPT }];
  for (var j = 0; j < conversationHistory.length; j++) {
    var h = conversationHistory[j];
    var role = h.role === "model" ? "assistant" : "user";
    var text = (h.parts && h.parts[0] && h.parts[0].text) ? h.parts[0].text : "";
    if (text) messages.push({ role: role, content: text });
  }
  messages.push({ role: "user", content: userText });

  var response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + API_KEY
    },
    body: JSON.stringify({
      model: MODEL,
      messages: messages,
      temperature: 0.7,
      max_tokens: 800
    })
  });

  // If rate limited, wait and retry once
  if (response.status === 429) {
    await new Promise(function(r) { setTimeout(r, 15000); });
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + API_KEY
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 800
      })
    });
  }

  if (!response.ok) {
    var err = await response.json().catch(function() { return null; });
    if (response.status === 429) throw new Error("Rate limit reached. Please wait a moment and try again.");
    throw new Error("API error (" + response.status + "): " +
      (err && err.error && err.error.message ? err.error.message : "Unknown"));
  }

  var data = await response.json();
  var replyText = (data && data.choices && data.choices[0] &&
                   data.choices[0].message && data.choices[0].message.content) ||
                  "I could not generate a response. Please try again.";

  // Save to history (trim large content)
  var historyUserParts = newUserParts.map(function(p) {
    if (p.inline_data) return { text: "[uploaded file]" };
    if (p.text && p.text.length > 800) return { text: p.text.slice(0, 800) + "...[report data]" };
    return p;
  });
  conversationHistory.push({ role: "user", parts: historyUserParts });
  conversationHistory.push({ role: "model", parts: [{ text: replyText }] });
  if (conversationHistory.length > 16) {
    conversationHistory = conversationHistory.slice(conversationHistory.length - 16);
  }

  return replyText;
}

// ── PDF text extraction ───────────────────────────────────────────────────────
function extractTextFromPdfBuffer(buffer) {
  var raw = "";
  try {
    raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  } catch(e) {
    raw = new TextDecoder("latin1").decode(new Uint8Array(buffer));
  }

  var chunks = [];

  var tjMatches = raw.match(/\((?:\\.|[^\\)])*\)\s*Tj/g) || [];
  tjMatches.forEach(function(m) {
    var t = m.replace(/\)\s*Tj$/, "").replace(/^\(/, "")
             .replace(/\\n/g, " ").replace(/\\r/g, " ")
             .replace(/\\\(/g, "(").replace(/\\\)/g, ")");
    if (t.trim().length > 1) chunks.push(t.trim());
  });

  var tjArrMatches = raw.match(/\[(?:[^\]]*)\]\s*TJ/g) || [];
  tjArrMatches.forEach(function(m) {
    var inner = m.replace(/\]\s*TJ$/, "").replace(/^\[/, "");
    var strings = inner.match(/\((?:\\.|[^\\)])*\)/g) || [];
    strings.forEach(function(s) {
      var t = s.slice(1, -1).replace(/\\n/g, " ").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
      if (t.trim().length > 1) chunks.push(t.trim());
    });
  });

  if (chunks.length < 5) {
    var fallback = raw.match(/[A-Za-z0-9 .,:()\-+%\/]{15,}/g) || [];
    chunks = chunks.concat(fallback.slice(0, 300));
  }

  return chunks.join(" ").replace(/\s{2,}/g, " ").trim().slice(0, 15000);
}

// ── File reading helpers ──────────────────────────────────────────────────────
function readFileAsText(file) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { resolve(String(r.result || "")); };
    r.onerror = function() { reject(new Error("Failed to read file")); };
    r.readAsText(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { resolve(r.result); };
    r.onerror = function() { reject(new Error("Failed to read file")); };
    r.readAsArrayBuffer(file);
  });
}

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var binary = "";
  var chunk = 0x8000;
  for (var i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── File upload handling ──────────────────────────────────────────────────────
async function handleFileSelection(file, isPhoto) {
  if (!file) return;

  if (file.size > 4 * 1024 * 1024) {
    appendMessage("Bot", "File is over 4 MB. Please upload a smaller file.", "bot");
    return;
  }

  if (isPhoto) {
    var reader = new FileReader();
    reader.onload = function() {
      var dataUrl = String(reader.result || "");
      var base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : "";
      uploadedReportContext = {
        kind: "photo", name: file.name,
        mimeType: file.type || "image/jpeg",
        base64: base64, previewUrl: dataUrl
      };
      appendUploadMessage(file, true, dataUrl);
      analyzeUploadedReport();
    };
    reader.readAsDataURL(file);
    return;
  }

  appendUploadMessage(file, false);
  setLoadingState(true);

  try {
    var mime = (file.type || "").toLowerCase();
    var lowerName = (file.name || "").toLowerCase();
    var isPdf = mime.includes("pdf") || /\.pdf$/i.test(lowerName);
    var isPlainText = mime.startsWith("text/") || /\.(txt|csv|json|md|xml|log)$/i.test(lowerName);

    if (isPdf) {
      var buffer = await readFileAsArrayBuffer(file);
      var extractedText = extractTextFromPdfBuffer(buffer);

      if (!extractedText || extractedText.trim().length < 30) {
        uploadedReportContext = {
          kind: "pdf-binary", name: file.name,
          mimeType: "application/pdf",
          base64: arrayBufferToBase64(buffer)
        };
      } else {
        uploadedReportContext = { kind: "text-file", name: file.name, text: extractedText };
      }
    } else if (isPlainText) {
      var text = (await readFileAsText(file)).slice(0, 15000);
      if (!text || text.trim().length < 20) {
        appendMessage("Bot", "Could not read this file. Please upload a PDF or image of the report.", "bot");
        setLoadingState(false);
        return;
      }
      uploadedReportContext = { kind: "text-file", name: file.name, text: text };
    } else {
      appendMessage("Bot", "Please upload the report as a photo, PDF, or text file.", "bot");
      setLoadingState(false);
      return;
    }

    await analyzeUploadedReport();
  } catch (error) {
    appendMessage("Bot", "Could not read this file. Try uploading a report photo instead.", "bot");
    console.warn("File error:", error);
  } finally {
    setLoadingState(false);
  }
}

async function analyzeUploadedReport() {
  if (!uploadedReportContext) return;

  appendTypingIndicator();
  setLiveStatus("thinking", "Reading your report...");

  try {
    var parts = [];

    if (uploadedReportContext.kind === "photo") {
      parts = [
        { text: "I've uploaded a medical report. Please analyze it thoroughly — tell me what type of report it is, list all key values, highlight anything abnormal with a brief explanation of what it means, and suggest which specialist(s) I should see." },
        { inline_data: { mime_type: uploadedReportContext.mimeType, data: uploadedReportContext.base64 } }
      ];
    } else if (uploadedReportContext.kind === "pdf-binary") {
      parts = [
        { text: "I've uploaded a medical PDF report. Please analyze it thoroughly — tell me what type of report it is, list all key values, highlight anything abnormal with a brief explanation of what it means, and suggest which specialist(s) I should see." },
        { inline_data: { mime_type: "application/pdf", data: uploadedReportContext.base64 } }
      ];
    } else if (uploadedReportContext.kind === "text-file") {
      parts = [{
        text: "Here is my medical report (" + uploadedReportContext.name + "):\n\n" +
              uploadedReportContext.text + "\n\n" +
              "Please analyze it thoroughly — tell me what type of report it is, list all key values, highlight anything abnormal with a brief explanation of what it means, and suggest which specialist(s) I should see."
      }];
    }

    var reply = await callGemini(parts);
    setLiveStatus("online", "Report analyzed.");
    removeTypingIndicator();
    appendMessage("Bot", reply, "bot");
  } catch (error) {
    removeTypingIndicator();
    setLiveStatus("ready", "Smart health guidance is available now");
    appendMessage("Bot", "Could not analyze the report automatically. Please paste the key values here and I'll explain them.", "bot");
    console.warn("Report analysis error:", error);
  }
}

// ── Send message ──────────────────────────────────────────────────────────────
function setLoadingState(loading) {
  sendBtn.disabled = loading;
  sendBtn.textContent = loading ? "Sending..." : "Send";
  if (fileBtn)  fileBtn.disabled  = loading;
  if (photoBtn) photoBtn.disabled = loading;
}

async function sendMessage() {
  var input = userInput.value.trim();
  if (!input) return;

  appendMessage("You", input, "user");
  userInput.value = "";

  // Name introduction
  var introducedName = extractIntroducedName(input);
  if (introducedName) {
    userName = introducedName;
    // Also add to history so AI knows the name
    conversationHistory.push({ role: "user", parts: [{ text: input }] });
    conversationHistory.push({ role: "model", parts: [{ text: "Hi " + userName + "! Great to meet you. I'm Raksha, your health assistant. What can I help you with today?" }] });
    appendMessage("Bot", "Hi " + userName + "! Great to meet you. I'm Raksha, your health assistant. What can I help you with today?", "bot");
    return;
  }

  setLoadingState(true);
  appendTypingIndicator();
  setLiveStatus("thinking", "Thinking...");

  try {
    var parts = [];

    // Attach report context if uploaded
    if (uploadedReportContext && uploadedReportContext.kind === "photo") {
      parts.push({ inline_data: { mime_type: uploadedReportContext.mimeType, data: uploadedReportContext.base64 } });
      parts.push({ text: input });
    } else if (uploadedReportContext && uploadedReportContext.kind === "pdf-binary") {
      parts.push({ inline_data: { mime_type: "application/pdf", data: uploadedReportContext.base64 } });
      parts.push({ text: input });
    } else if (uploadedReportContext && uploadedReportContext.kind === "text-file") {
      // Only inject report context on first question about it, after that history carries it
      var hasReportInHistory = conversationHistory.some(function(h) {
        return h.parts && h.parts[0] && h.parts[0].text && h.parts[0].text.indexOf(uploadedReportContext.name) !== -1;
      });
      if (!hasReportInHistory) {
        parts.push({ text: "Report data:\n" + uploadedReportContext.text + "\n\nUser question: " + input });
      } else {
        parts.push({ text: input });
      }
    } else {
      // Detect if user pasted report data inline (long text with numbers/units)
      var looksLikeReport = input.length > 100 && /(g\/dL|mg\/dL|mIU|µL|mmol|ng\/mL|Normal|WBC|TSH|Hemoglobin|Platelet|Cholesterol|Creatinine|Glucose|Bilirubin)/i.test(input);
      if (looksLikeReport) {
        // Store as report context so follow-up questions work
        uploadedReportContext = { kind: "text-file", name: "pasted-report", text: input };
        parts.push({ text: "The user has shared their medical report data. Analyze it thoroughly — identify the report type, list all values, clearly explain which ones are abnormal and what that means, and recommend which specialist(s) to consult.\n\nReport data:\n" + input });
      } else if (uploadedReportContext && uploadedReportContext.kind === "text-file") {
        // Follow-up question about previously pasted/uploaded report
        parts.push({ text: "Referring to my earlier report:\n" + uploadedReportContext.text + "\n\nMy question: " + input });
      } else {
        parts.push({ text: input });
      }
    }

    var reply = await callGemini(parts);
    setLiveStatus("online", "Response received.");
    removeTypingIndicator();
    appendMessage("Bot", reply, "bot");
  } catch (error) {
    removeTypingIndicator();
    setLiveStatus("ready", "Smart health guidance is available now");
    var errMsg = error.message || "";
    if (errMsg.indexOf("Rate limit") !== -1 || errMsg.indexOf("429") !== -1) {
      appendMessage("Bot", "I'm getting too many requests. Please wait 30 seconds and try again.", "bot");
    } else {
      appendMessage("Bot", "Sorry, couldn't reach the AI. Please check your API key and try again.", "bot");
    }
    console.warn("Gemini API error:", error);
  } finally {
    setLoadingState(false);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────
userInput.addEventListener("keydown", function(e) { if (e.key === "Enter") sendMessage(); });
sendBtn.addEventListener("click", sendMessage);

if (fileBtn && fileUploadInput) {
  fileBtn.addEventListener("click", function() { fileUploadInput.click(); });
  fileUploadInput.addEventListener("change", function() {
    handleFileSelection(fileUploadInput.files && fileUploadInput.files[0], false);
    fileUploadInput.value = "";
  });
}

if (photoBtn && photoUploadInput) {
  photoBtn.addEventListener("click", function() { photoUploadInput.click(); });
  photoUploadInput.addEventListener("change", function() {
    handleFileSelection(photoUploadInput.files && photoUploadInput.files[0], true);
    photoUploadInput.value = "";
  });
}

// ── Welcome message ───────────────────────────────────────────────────────────
appendMessage("Bot", "Hi! I'm Raksha, your personal health assistant.\nAsk me anything — symptoms, medicines, lab reports, or which doctor to see.\nYou can also upload a report and I'll analyze it for you.", "bot");
setLiveStatus("ready", "Smart health guidance is available now");
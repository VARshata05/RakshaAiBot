const API_KEY = "AIzaSyC50fAtLFofISHFsttr4C8gWVmOGhc_ioQ";
const API_URL =
	"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const systemPrompt = `
You are a healthcare assistant chatbot for a patient support platform.

Your role:
Help patients understand health symptoms, medical reports, and prescriptions in simple language.

Responsibilities:
- Explain medical terms
- Help understand blood test or scan reports
- Suggest which doctor or department to visit
- Provide basic health awareness
- Guide users to search hospitals using the website

Medical department guidance examples:
Chest pain → Cardiologist
Eye pain → Ophthalmologist
Skin problems → Dermatologist
Joint pain → Orthopedic
Stomach pain → Gastroenterologist
Headache or fever → General physician

Rules:
- Do NOT provide medical diagnosis
- Do NOT prescribe medicines
- Always advise consulting a doctor
- If symptoms seem severe, recommend emergency care

If a user asks for hospitals or doctors say:

"You can find nearby hospitals using our hospital finder page.
Please visit the hospital search section on the website."

Always keep responses:
- simple
- short
- patient-friendly
- max 3 short lines
- avoid long paragraphs

`;

const chatbox = document.getElementById("chatbox");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const fileBtn = document.getElementById("fileBtn");
const photoBtn = document.getElementById("photoBtn");
const fileUploadInput = document.getElementById("fileUploadInput");
const photoUploadInput = document.getElementById("photoUploadInput");
const liveStatusBadge = document.getElementById("liveStatusBadge");
const liveStatusText = document.getElementById("liveStatusText");

function setLiveStatus(state, text) {
	if (!liveStatusBadge || !liveStatusText) {
		return;
	}

	liveStatusBadge.className = `status-badge status-${state}`;
	liveStatusBadge.textContent =
		state === "online"
			? "Live AI online"
			: state === "ready"
				? "Assistant ready"
				: "Checking live AI...";
	liveStatusText.textContent = text;
}

function cleanText(value) {
	return String(value || "")
		.replace(/\s+/g, " ")
		.trim();
}

function formatBotReply(rawText) {
	const text = String(rawText || "")
		.replace(/\*+/g, "")
		.replace(/`+/g, "")
		.replace(/\s+\n/g, "\n")
		.trim();

	if (!text) {
		return "Please share a bit more detail so I can guide you clearly.";
	}

	const lines = text
		.split(/\n+/)
		.map((line) => cleanText(line))
		.filter(Boolean)
		.slice(0, 3);

	let result = lines.join("\n");
	if (!result) {
		result = cleanText(text);
	}

	if (result.length > 320) {
		result = `${result.slice(0, 317).trimEnd()}...`;
	}

	return result;
}

async function requestGemini(promptText) {
	const response = await fetch(`${API_URL}?key=${API_KEY}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			contents: [
				{
					parts: [{ text: promptText }]
				}
			],
			generationConfig: {
				temperature: 0.4,
				maxOutputTokens: 260
			}
		})
	});

	if (!response.ok) {
		const errorPayload = await response.json().catch(() => null);
		const apiError = cleanText(errorPayload?.error?.message);
		throw new Error(`API request failed (${response.status}): ${apiError}`);
	}

	return response.json();
}

function getDepartmentSuggestion(query) {
	if (/chest|heart|palpitation|breath|pressure/.test(query)) return "Cardiologist";
	if (/eye|vision|blur|red eye/.test(query)) return "Ophthalmologist";
	if (/skin|rash|itch|allergy|pimple/.test(query)) return "Dermatologist";
	if (/joint|knee|bone|back pain|shoulder|fracture/.test(query)) return "Orthopedic";
	if (/stomach|abdomen|acidity|gas|vomit|loose motion|diarrhea/.test(query)) return "Gastroenterologist";
	if (/headache|fever|cold|cough|weak|tired/.test(query)) return "General Physician";
	return "General Physician";
}

function buildSymptomAdvice(query) {
	if (/severe|unbearable|faint|blood|breathing|stroke|heart attack|unconscious/.test(query)) {
		return "This may be urgent.\nPlease seek emergency care now.\nCall local emergency services immediately.";
	}

	if (/hospital|doctor|nearby|clinic/.test(query)) {
		return "Use the hospital finder page to locate nearby hospitals.\nPlease open the hospital search section on this website.";
	}

	if (/report|blood test|scan|x-ray|mri|cbc|thyroid|sugar|cholesterol/.test(query)) {
		return "I can explain report terms in simple words.\nShare the test name and exact values.\nPlease confirm the interpretation with your doctor.";
	}

	if (/medicine|tablet|dose|prescription|drug/.test(query)) {
		return "I can explain common medicine use.\nDo not start or change dose on your own.\nPlease follow your doctor or pharmacist advice.";
	}

	const department = getDepartmentSuggestion(query);
	return `You can consult a ${department} first.\nRest and stay hydrated.\nSee a doctor if symptoms worsen or continue.`;
}

function getFallbackReply(userMessage) {
	const query = cleanText(userMessage).toLowerCase();
	const advice = buildSymptomAdvice(query);
	return formatBotReply(`${advice}\nShare age, main symptom, duration, and report values for better guidance.`);
}

function appendMessage(author, text, type) {
	const wrapper = document.createElement("div");
	wrapper.className = `message ${type}`;

	const title = document.createElement("div");
	title.className = "message-title";
	title.textContent = author;

	const body = document.createElement("div");
	body.className = "message-text";
	body.textContent = text;

	wrapper.appendChild(title);
	wrapper.appendChild(body);
	chatbox.appendChild(wrapper);
	chatbox.scrollTop = chatbox.scrollHeight;
}

function appendUploadMessage(file, isPhoto, previewSrc) {
	const wrapper = document.createElement("div");
	wrapper.className = "message user";

	const title = document.createElement("div");
	title.className = "message-title";
	title.textContent = "You";

	const body = document.createElement("div");
	body.className = "message-text";
	const sizeKb = Math.max(1, Math.round(file.size / 1024));
	body.textContent = isPhoto
		? `Photo uploaded: ${file.name} (${sizeKb} KB)`
		: `File uploaded: ${file.name} (${sizeKb} KB)`;

	wrapper.appendChild(title);
	wrapper.appendChild(body);

	if (isPhoto && previewSrc) {
		const preview = document.createElement("img");
		preview.className = "upload-preview";
		preview.src = previewSrc;
		preview.alt = "Uploaded photo preview";
		wrapper.appendChild(preview);
	}

	chatbox.appendChild(wrapper);
	chatbox.scrollTop = chatbox.scrollHeight;
}

function handleFileSelection(file, isPhoto) {
	if (!file) {
		return;
	}

	if (isPhoto) {
		const reader = new FileReader();
		reader.onload = () => {
			appendUploadMessage(file, true, String(reader.result || ""));
			appendMessage("Bot", "Photo received. Tell me what you want to understand about it.", "bot");
		};
		reader.readAsDataURL(file);
		return;
	}

	appendUploadMessage(file, false);
	appendMessage("Bot", "File received. Ask your question and I will guide you clearly.", "bot");
}

function setLoadingState(loading) {
	sendBtn.disabled = loading;
	sendBtn.textContent = loading ? "Sending..." : "Send";
	if (fileBtn) {
		fileBtn.disabled = loading;
	}
	if (photoBtn) {
		photoBtn.disabled = loading;
	}
}

async function sendMessage() {
	const input = userInput.value.trim();
	if (!input) {
		return;
	}

	appendMessage("You", input, "user");
	userInput.value = "";

	if (input.toLowerCase() === "yes") {
		appendMessage(
			"Care Guide",
			"You can find nearby hospitals using our hospital finder page. Please visit the hospital search section on the website.",
			"bot"
		);
		return;
	}

	if (!API_KEY) {
		appendMessage("Bot", getFallbackReply(input), "bot");
		setLiveStatus("ready", "Smart health guidance is available now");
		return;
	}

	setLoadingState(true);
	try {
		const data = await requestGemini(`${systemPrompt}\nUser: ${input}`);
		const reply =
			data?.candidates?.[0]?.content?.parts?.[0]?.text ||
			"I could not generate a response right now. Please try again.";

		setLiveStatus("online", "Gemini API responded successfully.");
		appendMessage("Bot", formatBotReply(reply), "bot");
	} catch (error) {
		setLiveStatus("ready", "Smart health guidance is available now");
		appendMessage("Bot", getFallbackReply(input), "bot");
		console.warn("Live AI unavailable, using fallback guidance.", error);
	} finally {
		setLoadingState(false);
	}
}

userInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") {
		sendMessage();
	}
});

sendBtn.addEventListener("click", sendMessage);

if (fileBtn && fileUploadInput) {
	fileBtn.addEventListener("click", () => {
		fileUploadInput.click();
	});

	fileUploadInput.addEventListener("change", () => {
		handleFileSelection(fileUploadInput.files?.[0], false);
		fileUploadInput.value = "";
	});
}

if (photoBtn && photoUploadInput) {
	photoBtn.addEventListener("click", () => {
		photoUploadInput.click();
	});

	photoUploadInput.addEventListener("change", () => {
		handleFileSelection(photoUploadInput.files?.[0], true);
		photoUploadInput.value = "";
	});
}

appendMessage(
	"Bot",
	"Hello. I am your healthcare assistant. Share symptoms, report values, or medicine doubts, and I will guide you in simple language.",
	"bot"
);

setLiveStatus("ready", "Smart health guidance is available now");
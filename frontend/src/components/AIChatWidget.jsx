import { useEffect, useRef, useState } from "react";
import "./AIChatWidget.css";
import { API_BASE_URL, apiFetch } from "../measurementApi";

const API_URL = `${API_BASE_URL}/chat`;
const WELCOME_MESSAGE =
  "Hello! I'm your Painting Assistant. Ask me about painting, project planning, colours, technology, or anything else.";

function initialMessages() {
  return [{ role: "assistant", text: WELCOME_MESSAGE }];
}

export default function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState(initialMessages);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, isOpen]);

  async function handleSend(event) {
    event.preventDefault();

    const message = input.trim();
    if (!message || isLoading) return;

    const history = messages
      .slice(1)
      .slice(-20)
      .map(({ role, text }) => ({ role, text: text.slice(0, 4000) }));
    setMessages((previous) => [...previous, { role: "user", text: message }]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await apiFetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      if (response.status === 404) {
        throw new Error(
          "The Flask server returned 404 for /api/chat. Restart the backend and confirm it is running the current backend/app.py."
        );
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("The AI service returned an unexpected response. Please try again.");
      }

      if (!response.ok) {
        throw new Error(
          data && typeof data.error === "string"
            ? data.error
            : "The AI could not respond. Please try again."
        );
      }

      const answer =
        data && typeof data.reply === "string" ? data.reply.trim() : "";
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: answer || "Sorry, I couldn't generate a response. Please try again.",
        },
      ]);
    } catch (error) {
      const errorMessage =
        error instanceof TypeError
          ? "Unable to connect to the AI service. Check that the Flask backend is running and try again."
          : error.message || "The AI could not respond. Please try again.";
      setMessages((previous) => [
        ...previous,
        { role: "assistant", text: errorMessage },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function clearChat() {
    if (isLoading) return;
    setMessages(initialMessages());
    setInput("");
  }

  return (
    <div className="ai-chat-widget">
      {isOpen && (
        <section className="ai-chat-panel" aria-label="Painting AI chat">
          <header className="ai-chat-header">
            <div className="ai-chat-avatar" aria-hidden="true">
              🎨
            </div>

            <div className="ai-chat-heading">
              <h3>Painting Assistant</h3>
              <span>
                <span className="ai-status-dot" />
                {isLoading ? "Thinking..." : "Ready to help"}
              </span>
            </div>

            <button
              type="button"
              className="ai-chat-clear"
              onClick={clearChat}
              disabled={isLoading}
              aria-label="Clear chat"
            >
              Clear
            </button>

            <button
              type="button"
              className="ai-chat-close"
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
            >
              ×
            </button>
          </header>

          <div className="ai-chat-messages" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`ai-message-row ${message.role}`}
              >
                <div className="ai-message-bubble">{message.text}</div>
              </div>
            ))}

            {isLoading && (
              <div className="ai-message-row assistant">
                <div
                  className="ai-message-bubble ai-chat-loading"
                  role="status"
                  aria-label="AI is responding"
                >
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form className="ai-chat-form" onSubmit={handleSend}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask me anything..."
              aria-label="Type your message"
              maxLength={2000}
              disabled={isLoading}
            />

            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
            >
              ➤
            </button>
          </form>

          <div className="ai-chat-footer">Powered by Gemini</div>
        </section>
      )}

      <button
        type="button"
        className={`ai-chat-toggle ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen((previous) => !previous)}
        aria-label={isOpen ? "Close AI chat" : "Open AI chat"}
        aria-expanded={isOpen}
      >
        {isOpen ? "×" : "✦"}
        {!isOpen && <span className="ai-chat-tooltip">Ask AI</span>}
      </button>
    </div>
  );
}

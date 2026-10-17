
import { useEffect, useRef, useState } from "react";
import "./AIChatWidget.css";

const AI_API_URL = "http://127.0.0.1:8000/chat";

export default function AIChatWidget({
  workspaceId,
  activeProjectId,
  activeProject,
  projects = [],
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hello! I'm your Painting Assistant. Ask me about measurements, quotations, expenses, or projects.",
    },
  ]);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, isOpen]);

  async function handleSend(event) {
    event.preventDefault();

    const message = input.trim();
    if (!message || isLoading) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", text: message },
    ]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(AI_API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    message,
    context: {
      workspaceId,
      activeProjectId,
      activeProject,
      projects,
      history: messages,
    },
  }),
});

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.response || "Sorry, I couldn't generate a response.",
        },
      ]);
    } catch (error) {
      console.error("AI chat error:", error);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Unable to connect to the AI service. Please check that the AI backend is running on port 8000.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="ai-chat-widget">
      {isOpen && (
        <section className="ai-chat-panel" aria-label="Painting AI chat">
          <header className="ai-chat-header">
            <div className="ai-chat-avatar">🎨</div>

            <div className="ai-chat-heading">
              <h3>Painting Assistant</h3>
              <span>
                <span className="ai-status-dot" />
                Ready to help
              </span>
            </div>

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
                <div className="ai-message-bubble">
                  {message.text}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="ai-message-row assistant">
                <div className="ai-message-bubble">
                  Thinking...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form className="ai-chat-form" onSubmit={handleSend}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about painting work..."
              aria-label="Type your message"
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

          <div className="ai-chat-footer">
            Painting Contractor Assistant
          </div>
        </section>
      )}

      <button
        type="button"
        className={`ai-chat-toggle ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Close AI chat" : "Open AI chat"}
        aria-expanded={isOpen}
      >
        {isOpen ? "×" : "✦"}
        {!isOpen && (
          <span className="ai-chat-tooltip">Ask AI</span>
        )}
      </button>
    </div>
  );
}

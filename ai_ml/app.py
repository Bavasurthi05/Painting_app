
from flask import Flask, jsonify, request
from chatbot.assistant import get_response
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={
    r"/*": {
        "origins": [
            "http://localhost:5173",
            "http://127.0.0.1:5173"
        ]
    }
})



@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "message": "Painting Contractor AI/ML Service",
        "status": "running"
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"})



@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    message = data.get("message", "").strip()

    if not message:
        return jsonify({"error": "Message is required"}), 400

    context = data.get("context", {})
    if not isinstance(context, dict):
        context = {}

    try:
        response = get_response(message, context)
        return jsonify({
            "message": message,
            "response": response
        })
    except Exception:
        app.logger.exception("AI chat request failed")
        return jsonify({
            "error": "The assistant could not process this request."
        }), 500



if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)

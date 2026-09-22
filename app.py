from flask import Flask, render_template, jsonify

app = Flask(__name__)

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/profile")
def profile():
    return render_template("profile.html")

@app.get("/api/config")
def config():
    return jsonify({
        "currency": "TON",
        "referral_percent": 2
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

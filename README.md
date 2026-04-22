# 💰 FinanceAI — Smart Personal Finance Manager

FinanceAI is a full-stack web application that helps users manage their finances efficiently. It allows users to track income and expenses, set budgets, analyze spending patterns, and get AI-powered financial advice.

---

## 🚀 Features

* 📊 **Dashboard**

  * View total balance, income, expenses, and savings rate
  * Recent transaction overview

* 💸 **Transactions**

  * Add and delete income/expense records
  * Categorize transactions

* 📉 **Budget Planner**

  * Set category-wise monthly budgets
  * Visual progress bars (safe / warning / exceeded)

* 📈 **Analytics**

  * Monthly income vs expense trends
  * Category-wise spending breakdown

* 🤖 **AI Financial Advisor**

  * Ask questions about your finances
  * Get personalized advice based on your data

* 🔮 **Prediction (ML)**

  * Uses Linear Regression to predict future expenses

---

## 🛠️ Technologies Used

### Frontend

* HTML
* CSS (Modern UI, Dark Theme)
* JavaScript (Dynamic UI, API calls)

### Backend

* Python (FastAPI)
* SQLite (Database)

### AI & ML

* Google Gemini API (AI advisor)
* Scikit-learn (Linear Regression)

---

## ⚙️ How It Works

1. User interacts with the frontend (browser)
2. JavaScript sends API requests to backend
3. FastAPI processes data and stores it in SQLite
4. AI module analyzes financial data
5. Results are sent back and displayed in UI

---

## 📦 Installation & Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-username/FinanceAI.git
cd FinanceAI
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Add Environment Variable

Create a `.env` file:

```env
GEMINI_API_KEY=your_api_key_here
```

### 4. Run Backend

```bash
uvicorn main:app --reload
```

### 5. Run Frontend

* Open `index.html` in browser
  OR
* Use Live Server

---

## 📊 Project Structure

```bash
FinanceAI/
│
├── main.py          # Backend (FastAPI)
├── finance.db       # SQLite Database
├── index.html       # Frontend UI
├── .env             # API Key
└── README.md
```

---

## 🎯 Use Cases

* Personal expense tracking
* Budget planning
* Financial analysis
* Smart financial decision making

---

## 🧠 Future Improvements

* User authentication (login/signup)
* Cloud database integration
* Mobile app version
* Advanced AI insights

---

## 📌 Author

* Nikunj Singh

---

## ⭐ Conclusion

FinanceAI combines web technologies, AI, and machine learning to create a smart financial assistant that helps users understand and improve their financial habits.

# fa25-cs411-team066-labubu

- Backend: Flask (port 5000)
- Frontend: React/Vite (port 5173)
- Database: Cloud SQL for MySQL 8

### Start Cloud SQL Auth Proxy
cloud-sql-proxy --port 3306 cs411-team66:us-central1:instanceone411

### Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py


### Frontend
cd frontend
npm install
npm run dev

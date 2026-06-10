import pymysql
import config

def get_connection():
    try:
        conn = pymysql.connect(
            host=config.DB_HOST,
            user=config.DB_USER,
            password=config.DB_PASSWORD,
            database=config.DB_NAME,
            port=config.DB_PORT,
            cursorclass=pymysql.cursors.DictCursor,  
            ssl={'ssl': {'ca': ''}} 
        )
        return conn
    except Exception as e:
        print("X Database connection error:", e)
        return None
from flask import Flask, jsonify
from flask_cors import CORS
from db import get_connection
from flask import request
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
CORS(app)

@app.route("/api/ping")
def ping():
    return jsonify({"status": "ok"})

@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    name = (data.get("name") or "").strip()
    password = data.get("password") or ""
    is_manager = bool(data.get("is_manager"))
    role = "admin" if is_manager else "user"

    if not email or not password:
        return jsonify({"error": "email and password required"}), 400

    conn = get_connection()
    if conn is None:
        return jsonify({"error": "Failed to connect to DB"}), 500

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM app_user WHERE email=%s", (email,))
            if cur.fetchone():
                return jsonify({"error": "Email already registered"}), 400

            pw_hash = generate_password_hash(password)
            cur.execute(
                """
                INSERT INTO app_user (email, name, password_hash, role, created_at, updated_at)
                VALUES (%s, %s, %s, %s, NOW(), NOW())
                """,
                (email, name, pw_hash, role),
            )
            uid = cur.lastrowid

        conn.commit()
        return jsonify({"user_id": uid, "email": email, "name": name, "role": role}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "email and password required"}), 400

    conn = get_connection()
    if conn is None:
        return jsonify({"error": "Failed to connect to DB"}), 500

    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, email, name, role, password_hash FROM app_user WHERE email=%s",
                (email,),
            )
            row = cur.fetchone()
            if not row or not row["password_hash"] or not check_password_hash(row["password_hash"], password):
                return jsonify({"error": "invalid email or password"}), 401

        return jsonify({
            "user_id": row["user_id"],
            "email": row["email"],
            "name": row["name"],
            "role": row["role"],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

# Retrieval 
@app.route("/api/restrooms")
def get_restrooms():
    conn = get_connection()
    if conn is None:
        return jsonify({"error": "Failed to connect to DB"}), 500

    try:
        with conn.cursor() as cursor:
            cursor.execute("""
SELECT DISTINCT
    r.restroom_id,
    r.name,
    r.city,
    r.hours,
    r.status,
    r.access_note,
    r.manager_id,
    r.created_at,
    r.updated_at,
    r.version,
    l.latitude,
    l.longitude,
    (
        SELECT AVG(rv.rating) 
        FROM review rv 
        WHERE rv.restroom_id = r.restroom_id
    ) as avg_rating,
    CASE 
        WHEN EXISTS (
            SELECT 1 
            FROM restroom_amenity ra 
            JOIN amenity a ON ra.amenity_id = a.amenity_id 
            WHERE ra.restroom_id = r.restroom_id 
            AND a.amenity_name = 'Wheelchair Accessible'
        ) THEN 1 
        ELSE 0 
    END as has_ada
FROM restroom r
JOIN location l ON r.restroom_id = l.restroom_id
""")
            data = cursor.fetchall()
        return jsonify({"data": data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

#Create restroom
@app.route("/api/restrooms", methods=["POST", "OPTIONS"])
def create_restroom():
    if request.method == "OPTIONS":
        return ("", 204)

    data = request.get_json() or {}
    required = ["name", "city", "hours", "status", "latitude", "longitude"]
    missing = [k for k in required if data.get(k) in (None, "")]
    if missing:
        return jsonify({"error": f"missing: {', '.join(missing)}"}), 400

    name        = data["name"]
    city        = data["city"]
    hours       = data["hours"]
    status      = data["status"]              
    lat         = data["latitude"]
    lon         = data["longitude"]
    access_note = data.get("access_note")
    manager_id  = data.get("manager_id")      

    conn = get_connection()
    if conn is None:
        return jsonify({"error": "Failed to connect to DB"}), 500

    try:
        with conn.cursor() as cur:
            cur.execute("START TRANSACTION")

            if manager_id is None:
                cur.execute(
                    """
                    INSERT INTO restroom
                        (name, status, hours, city, access_note, created_at, updated_at)
                    VALUES (%s,   %s,     %s,    %s,   %s,         NOW(),     NOW())
                    """,
                    (name, status, hours, city, access_note),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO restroom
                        (name, status, hours, city, access_note, manager_id, created_at, updated_at)
                    VALUES (%s,   %s,     %s,    %s,   %s,         %s,         NOW(),     NOW())
                    """,
                    (name, status, hours, city, access_note, manager_id),
                )

            rid = cur.lastrowid  

            try:
                cur.execute(
                    """
                    INSERT INTO location (restroom_id, latitude, longitude, geo)
                    VALUES (%s, %s, %s, ST_SRID(POINT(%s, %s), 4326))
                    """,
                    (rid, lat, lon, lon, lat),
                )
            except Exception:
                cur.execute(
                    """
                    INSERT INTO location (restroom_id, latitude, longitude, geo)
                    VALUES (%s, %s, %s, POINT(%s, %s))
                    """,
                    (rid, lat, lon, lon, lat),
                )

            conn.commit()

        return jsonify({"ok": True, "restroom_id": rid}), 201

    except Exception as e:
        try:
            conn.rollback()
        except:
            pass
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

#create review
@app.route("/api/reviews", methods=["POST", "OPTIONS"])
def create_review():
    if request.method == "OPTIONS":
        return ("", 204)

    data = request.get_json() or {}
    
    if not data.get("user_id") or not data.get("restroom_id") or not data.get("rating"):
        return jsonify({"error": "Missing required fields"}), 400

    conn = get_connection()
    if conn is None:
        return jsonify({"error": "Failed to connect to DB"}), 500

    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO review (user_id, restroom_id, rating, comment)
                VALUES (%s, %s, %s, %s)
            """, (data["user_id"], data["restroom_id"], data["rating"], data.get("comment", "")))
            
            conn.commit()
            
            return jsonify({
                "ok": True,
                "message": "Review submitted successfully"
            })
            
    except Exception as e:
        conn.rollback()
    
        error_str = str(e)
        if "Only one review per restroom per calendar day" in error_str:
            print(f"{error_str}")
            return jsonify({
                "error": "Daily review limit reached",
                "message": "You can only review this restroom once per day (enforced by database trigger)"
            }), 400
        
        print(f"{error_str}")
        return jsonify({"error": f"Database error: {error_str}"}), 500
            
    finally:
        conn.close()

#  Update 
@app.route("/api/restrooms/<int:rid>", methods=["PUT", "OPTIONS"])
def update_restroom(rid):
    if request.method == "OPTIONS":  
        return ("", 204)

    data = request.get_json() or {}
    conn = get_connection()
    if conn is None:
        return jsonify({"error": "Failed to connect to DB"}), 500

    try:
        with conn.cursor() as cur:
            expected_version = data.get("version")
            if expected_version is None:
                return jsonify({
                    "error": "VERSION_REQUIRED",
                    "message": "Version field is required for update"
                }), 400
        
            cur.execute("""
                UPDATE restroom
                   SET name=%s,
                       city=%s,
                       hours=%s,
                       status=%s,
                       updated_at=NOW(),
                       version = version + 1
                 WHERE restroom_id=%s 
                 AND version = %s
            """, (data.get("name"), data.get("city"),
                  data.get("hours"), data.get("status"), rid, expected_version))
            
            if cur.rowcount == 0:
                conn.rollback()
                cur.execute("SELECT restroom_id, version FROM restroom WHERE restroom_id=%s", (rid,))
                row = cur.fetchone()
                
                if not row:
                    return jsonify({"error": "NOT_FOUND", "message": "Restroom not found"}), 404
                else:
                    current_version = row["version"]
                    return jsonify({
                        "error": "CONCURRENT_MODIFICATION",
                        "message": f"This restroom has been modified by another user. Please reload and try again.",
                        "current_version": current_version
                    }), 409

        if "latitude" in data and "longitude" in data:
            try:
                cur.execute(
                    """
                    UPDATE location
                       SET latitude=%s,
                           longitude=%s,
                           geo = ST_SRID(POINT(%s, %s), 4326)
                     WHERE restroom_id=%s
                    """,
                    (data["latitude"], data["longitude"], 
                     data["longitude"], data["latitude"], rid)
                )
            except Exception as loc_err:
                print(f"Location update error (fallback to simple update): {loc_err}")
                cur.execute(
                    """
                    UPDATE location
                       SET latitude=%s,
                           longitude=%s
                     WHERE restroom_id=%s
                    """,
                    (data["latitude"], data["longitude"], rid)
                )

        conn.commit()
        return jsonify({"ok": True, "new_version": expected_version + 1})
    except Exception as e:
        conn.rollback()
        print(f"Update error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

# Delete
@app.route("/api/restrooms/<int:rid>", methods=["DELETE", "OPTIONS"])
def delete_restroom(rid):
    if request.method == "OPTIONS":
        return ("", 204)

    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")

    if not user_id:
        return jsonify({"error": "login required"}), 401

    conn = get_connection()
    if conn is None:
        return jsonify({"error": "Failed to connect to DB"}), 500

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT role FROM app_user WHERE user_id=%s", (user_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "user not found"}), 401
            if row["role"] != "admin":
                return jsonify({"error": "only managers can delete"}), 403

            cur.callproc("DeleteRestroomSafe", (rid,))

        conn.commit()
        return jsonify({"ok": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

if __name__ == "__main__":
    app.run(debug=True)
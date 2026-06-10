import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const API = import.meta.env.VITE_API_BASE ?? "http://localhost:5001";

const pin = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function km(a, b) {
  if (!a || !b) return null;
  const toRad = d => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtMi = (kmVal) =>
  kmVal == null ? "" : `${(kmVal * 0.621371).toFixed(1)} mile`;

export default function App() {
  // UI mode
  const [mode, setMode] = useState("browse"); // 'browse' | 'add'
  // Filters/sort
  const [search, setSearch] = useState("");
  const [onlyADA, setOnlyADA] = useState(false);
  const [sortBy, setSortBy] = useState("distance"); // 'distance' | 'rating'

  // Data + map center
  const [restrooms, setRestrooms] = useState([]);
  const [center, setCenter] = useState({ lat: 40.7128, lng: -74.006 });

  // Add form state
  const [draft, setDraft] = useState({
    name: "",
    city: "",
    status: "open",
    hours: "",
    latitude: "",
    longitude: "",
  });
  const [draftPin, setDraftPin] = useState(null);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "",
    status: "open",
    hours: "",
    city: "",
  });

  // Try to use user's location for distance sorting
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {}
    );
  }, []);

  // Load data
  const load = async () => {
    const r = await fetch(`${API}/api/restrooms`);
    const data = await r.json();
    setRestrooms(data);
  };
  useEffect(() => {
    load();
  }, []);

  // Filter + sort
  const enriched = useMemo(() => {
    const list = restrooms
      .map((r) => {
        const d =
          r.latitude && r.longitude
            ? km(center, { lat: r.latitude, lng: r.longitude })
            : null;
        return { ...r, dist_km: d };
      })
      .filter(
        (r) =>
          (!onlyADA || r.has_ada) &&
          (!search || r.name?.toLowerCase().includes(search.toLowerCase()))
      );

    if (sortBy === "rating") {
      list.sort((a, b) => (b.avg_rating ?? -1) - (a.avg_rating ?? -1));
    } else {
      list.sort((a, b) => (a.dist_km ?? 1e9) - (b.dist_km ?? 1e9));
    }
    return list;
  }, [restrooms, center, search, onlyADA, sortBy]);

  // Map click handler for Add mode
  function ClickToDrop() {
    useMapEvents({
      click(e) {
        if (mode !== "add") return;
        const { lat, lng } = e.latlng;
        setDraft((d) => ({
          ...d,
          latitude: lat.toFixed(6),
          longitude: lng.toFixed(6),
        }));
        setDraftPin({ lat, lng });
      },
    });
    return null;
  }

  // Create
  const submitNew = async (e) => {
    e.preventDefault();
    const body = {
      name: draft.name,
      city: draft.city,
      status: draft.status,
      hours: draft.hours,
      latitude: Number(draft.latitude),
      longitude: Number(draft.longitude),
    };
    if (
      !body.name ||
      !body.city ||
      Number.isNaN(body.latitude) ||
      Number.isNaN(body.longitude)
    ) {
      alert("Fill name, city, then click the map to set latitude/longitude.");
      return;
    }
    const res = await fetch(`${API}/api/restrooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    setDraft({
      name: "",
      city: "",
      status: "open",
      hours: "",
      latitude: "",
      longitude: "",
    });
    setDraftPin(null);
    setMode("browse");
    await load();
  };

  // Delete
  const remove = async (id) => {
    if (!confirm(`Delete restroom ${id}?`)) return;
    await fetch(`${API}/api/restrooms/${id}`, { method: "DELETE" });
    await load();
  };

  // Update (start + save)
  function startEdit(r) {
    setEditingId(r.restroom_id);
    setEditForm({
      name: r.name ?? "",
      status: r.status ?? "open",
      hours: r.hours ?? "",
      city: r.city ?? "",
    });
  }
  async function saveEdit(rid) {
    const res = await fetch(`${API}/api/restrooms/${rid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    setEditingId(null);
    await load();
  }

  return (
    <div style={{ display: "grid", gridTemplateRows: "56px 1fr", height: "100vh" }}>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          borderBottom: "1px solid #ddd",
          background: "#fff",
        }}
      >
        <button onClick={() => setMode("add")}>Add a Restroom</button>
        <button>Request Update</button>
        <div style={{ marginLeft: "auto" }} />
        <button onClick={() => setMode("browse")}>Login</button>
        <span>/</span>
        <button onClick={() => setMode("browse")}>Sign up</button>
      </div>

      {/* Body: sidebar + map */}
      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr" }}>
        {/* Sidebar */}
        <div
          style={{
            padding: 16,
            borderRight: "1px solid #ddd",
            overflow: "auto",
            background: "#fff",
            zIndex: 2,
          }}
        >
          {mode === "browse" ? (
            <>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by location/name"
                style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
              />

              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  id="ada"
                  type="checkbox"
                  checked={onlyADA}
                  onChange={(e) => setOnlyADA(e.target.checked)}
                />
                <label htmlFor="ada" style={{ fontWeight: 600 }}>
                  ADA
                </label>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ fontWeight: 700 }}>Filter By</div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  style={{ marginLeft: "auto", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 8 }}
                >
                  <option value="distance">Distance</option>
                  <option value="rating">Rating</option>
                </select>
              </div>

              {/* Default list: nearest/top-rated (according to sort) */}
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {enriched.slice(0, 8).map((r) => (
                  <button
                    key={r.restroom_id}
                    onClick={() => {
                      if (r.latitude && r.longitude) setCenter({ lat: r.latitude, lng: r.longitude });
                    }}
                    style={{
                      textAlign: "left",
                      border: "1px solid #eee",
                      borderRadius: 8,
                      padding: "10px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{r.name}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>
                        {r.city} {r.has_ada ? "· ADA" : ""} {r.avg_rating ? ` · ${r.avg_rating}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {sortBy === "distance" ? fmtMi(r.dist_km) : r.avg_rating ?? "—"}
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            // ADD MODE
            <form onSubmit={submitNew} style={{ display: "grid", gap: 14 }}>
              <h2 style={{ margin: "4px 0 0" }}>Add / Update Restroom Request</h2>

              <label>
                <div style={{ fontWeight: 600 }}>Restroom Name</div>
                <input
                  className="inp"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Enter restroom name"
                />
              </label>

              <label>
                <div style={{ fontWeight: 600 }}>Location</div>
                <input
                  className="inp"
                  value={draft.city}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                  placeholder="City or address"
                />
              </label>

              <label>
                <div style={{ fontWeight: 600 }}>Hours</div>
                <input
                  className="inp"
                  value={draft.hours}
                  onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
                  placeholder="e.g., 24/7 or 9AM–5PM"
                />
              </label>

              <label>
                <div style={{ fontWeight: 600 }}>Status</div>
                <select
                  className="inp"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                >
                  <option>open</option>
                  <option>seasonal</option>
                  <option>closed</option>
                  <option>unknown</option>
                </select>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label>
                  <div style={{ fontWeight: 600 }}>Latitude</div>
                  <input
                    className="inp"
                    value={draft.latitude}
                    onChange={(e) => setDraft({ ...draft, latitude: e.target.value })}
                    placeholder="click map…"
                  />
                </label>
                <label>
                  <div style={{ fontWeight: 600 }}>Longitude</div>
                  <input
                    className="inp"
                    value={draft.longitude}
                    onChange={(e) => setDraft({ ...draft, longitude: e.target.value })}
                    placeholder="click map…"
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit">Submit</button>
                <button type="button" onClick={() => setMode("browse")}>
                  Cancel
                </button>
              </div>

              <style>{`.inp{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;}`}</style>
            </form>
          )}
        </div>

        {/* Map */}
        <div style={{ position: "relative", zIndex: 1 }}>
          <MapContainer
            center={[center.lat, center.lng]}
            zoom={12}
            style={{ height: "calc(100vh - 56px)", width: "100%" }}
            scrollWheelZoom
          >
            <TileLayer
              attribution="&copy; OpenStreetMap"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToDrop />

            {/* Existing markers */}
            {enriched.map((r) =>
              r.latitude && r.longitude ? (
                <Marker key={r.restroom_id} position={[r.latitude, r.longitude]} icon={pin}>
                  <Popup>
                    {editingId === r.restroom_id ? (
                      // EDIT MODE
                      <div style={{ minWidth: 220, display: "grid", gap: 8 }}>
                        <div>
                          <b>Edit Restroom</b>
                        </div>

                        <label style={{ display: "grid", gap: 4 }}>
                          <span>Name</span>
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          />
                        </label>

                        <label style={{ display: "grid", gap: 4 }}>
                          <span>Status</span>
                          <select
                            value={editForm.status}
                            onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                          >
                            <option>open</option>
                            <option>seasonal</option>
                            <option>closed</option>
                            <option>unknown</option>
                          </select>
                        </label>

                        <label style={{ display: "grid", gap: 4 }}>
                          <span>Hours</span>
                          <input
                            value={editForm.hours}
                            onChange={(e) => setEditForm({ ...editForm, hours: e.target.value })}
                          />
                        </label>

                        <label style={{ display: "grid", gap: 4 }}>
                          <span>City</span>
                          <input
                            value={editForm.city}
                            onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                          />
                        </label>

                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          <button onClick={() => saveEdit(r.restroom_id)}>Save</button>
                          <button onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      // VIEW MODE
                      <div style={{ minWidth: 200 }}>
                        <div
                          style={{
                            fontSize: 12,
                            float: "right",
                            border: "1px solid #222",
                            borderRadius: 12,
                            padding: "1px 6px",
                          }}
                        >
                          {r.avg_rating ?? "—"}
                        </div>
                        <div>
                          <b>Name:</b> {r.name}
                        </div>
                        <div>
                          <b>Hours:</b> {r.hours ?? "-"}
                        </div>
                        <div>
                          <b>Status:</b> {r.status}
                          {r.has_ada ? " · ADA" : ""}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button onClick={() => startEdit(r)}>Edit</button>
                          <button onClick={() => remove(r.restroom_id)}>Delete</button>
                        </div>
                      </div>
                    )}
                  </Popup>
                </Marker>
              ) : null
            )}

            {/* Draft pin when adding */}
            {mode === "add" && draftPin && (
              <Marker position={[draftPin.lat, draftPin.lng]} icon={pin}>
                <Popup>
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 6px",
                      border: "1px solid #222",
                      borderRadius: 12,
                      background: "#ffef9e",
                    }}
                  >
                    NEW
                  </span>
                  <div style={{ marginTop: 6 }}>
                    {draft.name || "(unnamed)"} <br />
                    {draft.city || ""} <br />
                    {draft.latitude}, {draft.longitude}
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
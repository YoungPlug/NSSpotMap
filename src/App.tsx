import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { createClient } from '@supabase/supabase-js'
import L from 'leaflet'

type City = 'novi-sad' | 'belgrade'
type Spot = { id: string; name: string; category: string; note: string; city: City; lat: number; lng: number; photo?: string; createdAt: number }
type SpotRow = { id: string; name: string; category: string; note: string; city: City; lat: number; lng: number; photo_url: string | null; created_at: string }
type Connection = 'loading' | 'online' | 'local' | 'error'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null
const cities: Record<City, { label: string; center: [number, number]; zoom: number }> = {
  'novi-sad': { label: 'Нови-Сад', center: [45.255, 19.845], zoom: 13 },
  belgrade: { label: 'Белград', center: [44.8125, 20.4612], zoom: 12 },
}
const categories = ['Перила', 'Грань', 'Лестница', 'Скейт-парк', 'Мануал-бокс', 'Другое']
const starterSpots: Spot[] = [
  { id: 'sample-ns', name: 'Скейт-парк Нови-Сад', category: 'Скейт-парк', note: 'Стартовая точка — парк в районе Лиман.', city: 'novi-sad', lat: 45.2385, lng: 19.8462, photo: 'https://novisad.rs/sites/default/files/imagecache/800xXXX/images/vratolomije4.jpg', createdAt: 1 },
  { id: 'sample-bg', name: 'Скейт-парк Ушче', category: 'Скейт-парк', note: 'Стартовая точка для спотов на Ушче.', city: 'belgrade', lat: 44.81538, lng: 20.44065, photo: 'https://www.eyesonbelgrade.com/images/NewBelgrade/Skateboardramps.jpg', createdAt: 2 },
]
const readSpots = (): Spot[] => {
  try {
    const raw = localStorage.getItem('spotmap-spots')
    if (!raw) return starterSpots
    const saved = JSON.parse(raw) as Spot[]
    return [...starterSpots, ...saved.filter((spot) => !starterSpots.some((starter) => starter.id === spot.id))]
  } catch { return starterSpots }
}
const toSpot = (row: SpotRow): Spot => ({ id: row.id, name: row.name, category: row.category, note: row.note, city: row.city, lat: row.lat, lng: row.lng, photo: row.photo_url ?? undefined, createdAt: Date.parse(row.created_at) })
const iconFor = (category: string, active = false) => L.divIcon({
  className: 'spot-pin-wrap',
  html: `<div class="spot-pin ${active ? 'active' : ''}"><span>${category === 'Перила' ? '━' : category === 'Грань' ? '▱' : category === 'Лестница' ? '▤' : category === 'Скейт-парк' ? '▰' : category === 'Мануал-бокс' ? '▰' : '●'}</span></div>`,
  iconSize: [38, 46], iconAnchor: [19, 42], popupAnchor: [0, -38],
})

function MapMotion({ city }: { city: City }) {
  const map = useMap()
  useEffect(() => { map.flyTo(cities[city].center, cities[city].zoom, { duration: 0.8 }) }, [city, map])
  return null
}
function ClickToPlace({ onPick }: { onPick: (point: [number, number]) => void }) {
  useMapEvents({ click: (event) => onPick([event.latlng.lat, event.latlng.lng]) })
  return null
}
function App() {
  const [spots, setSpots] = useState<Spot[]>(() => supabase ? [] : readSpots())
  const [connection, setConnection] = useState<Connection>(supabase ? 'loading' : 'local')
  const [city, setCity] = useState<City>('novi-sad')
  const [filter, setFilter] = useState('Все споты')
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  const [draftPoint, setDraftPoint] = useState<[number, number] | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState(categories[0])
  const [note, setNote] = useState('')
  const [photoFile, setPhotoFile] = useState<File>()
  const [photoPreview, setPhotoPreview] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const visibleSpots = useMemo(() => spots.filter((s) => s.city === city && (filter === 'Все споты' || s.category === filter)), [spots, city, filter])

  useEffect(() => {
    if (!supabase) {
      localStorage.setItem('spotmap-spots', JSON.stringify(spots))
      return
    }
    let active = true
    const channel = supabase.channel('public-spots-map').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'spots' }, (payload) => {
      const incoming = toSpot(payload.new as SpotRow)
      if (active) setSpots((current) => current.some((spot) => spot.id === incoming.id) ? current : [incoming, ...current])
    }).subscribe((status) => {
      if (active && status === 'SUBSCRIBED') setConnection('online')
      if (active && status === 'CHANNEL_ERROR') setConnection('error')
    })
    void supabase.from('spots').select('*').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (!active) return
      if (error) { setConnection('error'); setNotice('Не удалось загрузить споты. Проверь настройки общей карты.'); return }
      setSpots((current) => {
        const rows = (data as SpotRow[]).map(toSpot)
        const arrivedWhileLoading = current.filter((spot) => !rows.some((row) => row.id === spot.id))
        return [...arrivedWhileLoading, ...rows]
      })
    })
    return () => { active = false; void supabase?.removeChannel(channel) }
  }, [])

  const openAdd = (point?: [number, number]) => { setDraftPoint(point ?? cities[city].center); setDialog(true) }
  const addSpot = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !draftPoint || saving) return
    setSaving(true)
    try {
      let photoUrl = photoPreview
      if (supabase) {
        if (photoFile) {
          const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, '-')
          const path = `${crypto.randomUUID()}-${safeName}`
          const { error: uploadError } = await supabase.storage.from('spot-photos').upload(path, photoFile, { contentType: photoFile.type, upsert: false })
          if (uploadError) throw uploadError
          photoUrl = supabase.storage.from('spot-photos').getPublicUrl(path).data.publicUrl
        }
        const { data, error } = await supabase.from('spots').insert({ name: name.trim(), category, note: note.trim(), city, lat: draftPoint[0], lng: draftPoint[1], photo_url: photoUrl ?? null }).select('*').single()
        if (error) throw error
        const created = toSpot(data as SpotRow)
        setSpots((all) => all.some((spot) => spot.id === created.id) ? all : [created, ...all])
        setSelected(created.id)
      } else {
        const created: Spot = { id: crypto.randomUUID(), name: name.trim(), category, note: note.trim(), city, lat: draftPoint[0], lng: draftPoint[1], photo: photoPreview, createdAt: Date.now() }
        setSpots((all) => [created, ...all]); setSelected(created.id)
      }
      setDialog(false); setName(''); setNote(''); setPhotoFile(undefined); setPhotoPreview(undefined)
      setNotice(supabase ? 'Спот добавлен — теперь он виден всем' : 'Спот сохранён в этом браузере. Для общей карты подключи Supabase.')
    } catch (error) {
      console.error(error)
      setNotice('Не удалось добавить спот. Попробуй ещё раз.')
    } finally { setSaving(false); window.setTimeout(() => setNotice(''), 4500) }
  }

  const statusText = connection === 'online' ? 'ВИДНО ВСЕМ · ОНЛАЙН' : connection === 'loading' ? 'ПОДКЛЮЧАЕМСЯ…' : connection === 'error' ? 'ОШИБКА ПОДКЛЮЧЕНИЯ' : 'ЛОКАЛЬНО · НУЖНА БАЗА'
  return <main className="app-shell">
    <aside className="sidebar">
      <header className="brand"><div className="brand-mark">t<span>·</span></div><div><div className="brand-name">споты</div><div className="brand-caption">карта нашей компании</div></div></header>
      <div className="city-switch" role="tablist" aria-label="Выбрать город">{(Object.keys(cities) as City[]).map((key) => <button role="tab" aria-selected={city === key} className={city === key ? 'city-tab chosen' : 'city-tab'} key={key} onClick={() => { setCity(key); setSelected(null) }}>{cities[key].label}</button>)}</div>
      <section className="list-heading"><div><div className="eyebrow">НАША КАРТА</div><h1>Споты, которые<br />стоит знать</h1></div><div className="total-count">{visibleSpots.length}<span>спотов</span></div></section>
      <button className="add-button" onClick={() => openAdd()}>＋ <span>Добавить спот</span></button>
      <div className="filter-row"><button className={filter === 'Все споты' ? 'filter-chip on' : 'filter-chip'} onClick={() => setFilter('Все споты')}>Все споты</button>{categories.map((c) => <button key={c} className={filter === c ? 'filter-chip on' : 'filter-chip'} onClick={() => setFilter(filter === c ? 'Все споты' : c)}>{c}</button>)}</div>
      <div className="spot-list">{visibleSpots.length === 0 ? <div className="empty-list"><span>↗</span><strong>Здесь пока нет спотов</strong><p>Добавь первую точку на карту.</p></div> : visibleSpots.map((spot) => <button key={spot.id} className={`spot-card ${selected === spot.id ? 'selected' : ''}`} onClick={() => setSelected(spot.id)}>
        <div className="card-image">{spot.photo ? <img src={spot.photo} alt={`Фото: ${spot.name}`} /> : <span>{spot.category === 'Скейт-парк' ? '🛹' : spot.category === 'Перила' ? '━' : spot.category === 'Грань' ? '▱' : spot.category === 'Лестница' ? '▤' : spot.category === 'Мануал-бокс' ? '▰' : '↗'}</span>}</div><div className="card-copy"><div className="card-meta">{spot.category}<i>·</i>{spot.city === 'novi-sad' ? 'Нови-Сад' : 'Белград'}</div><strong>{spot.name}</strong><p>{spot.note || 'Спот на карте — добавь свою заметку.'}</p></div><span className="card-arrow">↗</span>
      </button>)}</div>
      <footer className="sidebar-footer"><span className={`cloud-dot ${connection}`}/><div className="friends-copy"><strong>Общая карта</strong><small>{statusText}</small></div></footer>
    </aside>
    <section className="map-panel"><MapContainer center={cities[city].center} zoom={cities[city].zoom} zoomControl={false} className="map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><MapMotion city={city}/><ClickToPlace onPick={(point) => openAdd(point)}/>{visibleSpots.map((spot) => <Marker key={spot.id} position={[spot.lat, spot.lng]} icon={iconFor(spot.category, selected === spot.id)} eventHandlers={{ click: () => setSelected(spot.id) }} />)}</MapContainer>
      <div className="map-topline"><div className="map-location"><span className="location-dot"/>{cities[city].label}<span className="location-divider">/</span>Сербия</div><div className="map-tools"><span className={`live-indicator ${connection}`}/>{statusText}</div></div>
      <div className="map-hint"><span>＋</span> Нажми на карту, чтобы добавить спот</div>
      <div className="map-credit">Карта © OpenStreetMap</div>
      <button className="mobile-add" onClick={() => openAdd()}>＋</button>
      {selected && spots.find((s) => s.id === selected && s.city === city) && <div className="selected-card"><button className="close-selected" onClick={() => setSelected(null)}>×</button>{spots.find((s) => s.id === selected)?.photo && <img src={spots.find((s) => s.id === selected)?.photo} alt=""/>}<span className="eyebrow">{spots.find((s) => s.id === selected)?.category}</span><strong>{spots.find((s) => s.id === selected)?.name}</strong><p>{spots.find((s) => s.id === selected)?.note}</p></div>}
    </section>
    {dialog && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDialog(false) }}><form className="place-modal" onSubmit={(e) => { void addSpot(e) }}><button type="button" className="modal-close" onClick={() => setDialog(false)}>×</button><div className="eyebrow">НОВЫЙ СПОТ · {cities[city].label.toUpperCase()}</div><h2>Добавить спот</h2><p className="modal-intro">Отметь точку — она появится на общей карте.</p><label className="field-label">Название<input autoFocus required maxLength={70} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, длинная грань…" /></label><label className="field-label">Категория<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label><label className="field-label">Заметка <span className="optional">необязательно</span><textarea maxLength={220} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Расскажи, чем хорош этот спот" rows={3}/></label><label className="field-label">Фотография <span className="optional">необязательно</span><label className="photo-picker">{photoPreview ? <img src={photoPreview} alt="Предпросмотр"/> : <><span>＋</span><span>Прикрепить фото</span></>}<input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (!file.type.startsWith('image/') || file.size > 3_500_000) { setNotice('Выбери фото до 3,5 МБ'); window.setTimeout(() => setNotice(''), 3000); return } setPhotoFile(file); const reader = new FileReader(); reader.onload = () => setPhotoPreview(String(reader.result)); reader.readAsDataURL(file) }}/></label></label><div className="coords-note">⌖ Точка выбрана · {draftPoint?.[0].toFixed(4)}, {draftPoint?.[1].toFixed(4)}</div><button className="submit-button" type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Добавить на общую карту'} <span>↗</span></button></form></div>}
    {notice && <div className="toast">{notice}</div>}
  </main>
}
export default App

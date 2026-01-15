# Hızlı Başlangıç Rehberi - Lokasyon Seçim Özelliği

## 5 Dakikalık Kurulum

### 1️⃣ Google Maps API Anahtarı Alın (2 dakika)

1. https://console.cloud.google.com/ adresine gidin
2. **APIs & Services** → **Library** kısmında arayın ve şunları aktif edin:
   - **Maps JavaScript API**
   - **Geocoding API**
3. **Credentials** → **Create** → **API Key** oluşturun
4. API anahtarını kopyalayın

### 2️⃣ API Anahtarını Ekleyin (1 dakika)

`yemek_verenler.ejs` dosyasını açın ve 279. satırda:

```javascript
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_GOOGLE_MAPS_API_KEY&libraries=places,geocoder"></script>
```

`YOUR_GOOGLE_MAPS_API_KEY` yerine API anahtarınızı yazın. Örneğin:

```javascript
<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDu8pZ0w_FnwzP7c_eL9Zmm3CqYxL5vQb0&libraries=places,geocoder"></script>
```

### 3️⃣ Uygulamayı Başlatın (2 dakika)

```bash
cd c:\Users\Göktuğ\Desktop\Bitirme2
node server.js
```

Web tarayıcısında açın: `http://localhost:3000`

## Özellikleri Test Etme

### ✅ Manuel Lokasyon Giriş

1. Yemek Ekle formuna gidin
2. 🏙️ İl, 🏘️ İlçe, 🛣️ Sokak, 🏡 Mahalle alanlarını doldurun
3. Tüm alanlar otomatik birleştirilir

### ✅ Harita ile Seçim

1. "🗺️ Harita ile Seç" butonuna tıklayın
2. Harita açılacak ve Türkiye merkezinde gösterilecek
3. Harita üzerinde bir konuma tıklayın
4. Kırmızı marker (işaretçi) gösterilecek
5. "✓ Konumu Onayla" butonuna tıklayın
6. Lokasyon alanları otomatik dolacak

### ✅ Yemek Detaylarında Lokasyon Göster

1. Yemek kartında "Detay" butonuna tıklayın
2. Modal penceresinde 📍 Lokasyon bölümünü görün
3. Format: "İl, İlçe, Mahalle, Sokak" şeklinde gösterilir

## Dosya Yapısı

```
yemek_verenler.ejs
├── HTML Form (Lokasyon Alanları)
├── CSS Stiller (Modal, Buton, Input Alanları)
└── JavaScript
    ├── openLocationMap() - Harita açma
    ├── getAddressFromCoordinates() - Adres alma
    ├── updateLokasyonHidden() - Form verisi güncelleme
    └── Form Doğrulama
```

## Hata Durumunda

### "Harita yüklenmiyor"
→ API anahtarını kontrol et (F12 → Console'da hata mesajını oku)

### "Lokasyon bilgileri doldurulmuyor"
→ Geocoding API'nin aktif olduğunu kontrol et

### "Maps is not defined"
→ Script tagındaki API anahtarını kontrol et

## İletişim

Sorular için GOOGLE_MAPS_KURULUM.md dosyasına bakınız.

---
**Tamamlama Tarihi:** 22 Aralık 2025

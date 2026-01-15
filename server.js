const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);

const app = express();
const port = 3000;
const db = new sqlite3.Database("yemek_platformu.db");

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, p) => {
    console.error('UNHANDLED REJECTION:', reason);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    image TEXT,
    description TEXT,
    miktar TEXT,
    zaman TEXT,
    lokasyon TEXT,
    status TEXT DEFAULT 'hazir',
    owner_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Mevcut foods tablosuna owner_email kolonu ekle (eğer yoksa)
  db.run(`ALTER TABLE foods ADD COLUMN owner_email TEXT`, (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding owner_email column:", err);
    }
  });

  db.run(
    `ALTER TABLE foods ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
    (err) => {
      if (err && !err.message.includes("duplicate column name")) {
        console.error("Error adding created_at column:", err);
      }
    }
  );

  db.run(`ALTER TABLE foods ADD COLUMN english_name TEXT`, (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      console.error("Error adding column:", err);
    }
  });

  // Kayıtlı konumlar tablosu
  db.run(`CREATE TABLE IF NOT EXISTS saved_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    baslik TEXT,
    il TEXT,
    ilce TEXT,
    mahalle TEXT,
    sokak TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
  )`);

  // Bildirimler tablosu
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    message TEXT NOT NULL,
    food_id INTEGER,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE,
    FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE CASCADE
  )`);

  // Yemek talepleri tablosu
  db.run(`CREATE TABLE IF NOT EXISTS food_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id INTEGER NOT NULL,
    requester_email TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE CASCADE,
    FOREIGN KEY (requester_email) REFERENCES users(email) ON DELETE CASCADE,
    FOREIGN KEY (owner_email) REFERENCES users(email) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    subject TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id INTEGER,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE CASCADE
  )`);

  db.get("SELECT COUNT(*) as count FROM foods", (err, row) => {
    if (row.count === 0) {
      const stmt = db.prepare(
        "INSERT INTO foods (name, image, description, miktar, zaman, lokasyon, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      stmt.run(
        "Tavuklu Pilav",
        "images/tavuk-pilav.jpg",
        "Taze, sıcak tavuklu pilav. Acil alınmalı.",
        "6 porsiyon",
        "19:00",
        "Düzce Üniversitesi Yemekhane",
        "hazir"
      );
      stmt.run(
        "Sebzeli Salata",
        "images/sebzeli-salata.jpg",
        "Hazırda soğuk servis, yeşillikler taze.",
        "4 porsiyon",
        "18:30",
        "Düzce Üniversitesi Yemekhane",
        "hazir"
      );
      stmt.run(
        "Mercimek Çorbası",
        "images/MercimekÇorbası.jpg",
        "Sıcak çorba, kısa sürede alınmalı.",
        "8 porsiyon",
        "20:00",
        "Düzce Üniversitesi Yemekhane",
        "yakinda"
      );
      stmt.finalize();
    }
  });

  db.run(`ALTER TABLE notifications ADD COLUMN is_read INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes("duplicate column name")) {
      // console.error("Column already exists or error:", err);
    }
  });
});

app.set("view engine", "ejs");
app.set("views", __dirname);

// Session yapılandırması
app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.db",
      dir: __dirname,
    }),
    secret: "yemek-platformu-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 gün
      httpOnly: true,
      secure: false, // Production'da true yapılmalı (HTTPS gerektirir)
    },
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // JSON istekleri için

// Protect yemek_alanlar.html specifically before static middleware
app.get('/yemek_alanlar.html', requireAuth, (req, res) => {
  res.sendFile(__dirname + '/yemek_alanlar.html');
});

app.use(express.static(".")); // HTML dosyalarını serve et

// Authentication middleware
// Middleware to require login
function requireAuth(req, res, next) {
  // Prevent caching of protected pages
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");

  if (req.session && req.session.user) {
    next();
  } else {
    // AJAX isteği ise 401 dön, değilse login sayfasına yönlendir
    if (req.xhr || req.headers.accept.indexOf("json") > -1) {
      res.status(401).json({ error: "Auth required" });
    } else {
      const htmlContent = `
         <!DOCTYPE html>
         <html lang="tr">
         <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Giriş Gerekli</title>
            <style>
                body {
                    margin: 0;
                    height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    font-family: 'Segoe UI', sans-serif;
                    background: url('https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1470&q=80') no-repeat center center fixed;
                    background-size: cover;
                }
                .overlay {
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 100%;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(8px);
                }
                .modal {
                    position: relative;
                    background: white;
                    padding: 40px;
                    border-radius: 20px;
                    text-align: center;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                    max-width: 400px;
                    width: 90%;
                    animation: popIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
                }
                @keyframes popIn {
                    from { transform: scale(0.8); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                h1 { color: #e53935; margin: 0 0 15px 0; font-size: 24px; }
                p { color: #555; font-size: 16px; margin-bottom: 25px; }
                .timer { font-size: 40px; font-weight: bold; color: #2196F3; margin: 20px 0; }
                .btn {
                    background: #2196F3; color: white; border: none;
                    padding: 12px 30px; border-radius: 50px;
                    text-decoration: none; font-weight: bold;
                    display: inline-block; transition: transform 0.2s;
                }
                .btn:hover { transform: scale(1.05); }
            </style>
         </head>
         <body>
            <div class="overlay"></div>
            <div class="modal">
                <div style="font-size: 60px; margin-bottom: 10px;">🔒</div>
                <h1>Erişim Reddedildi</h1>
                <p>Bu sayfayı görüntülemek için lütfen giriş yapınız.</p>
                <div class="timer" id="countdown">3</div>
                <p>Saniye içinde ana sayfaya yönlendiriliyorsunuz...</p>
                <a href="/Ana_Sayfa.html" class="btn">Hemen Git</a>
            </div>
            <script>
                let count = 3;
                const timerEl = document.getElementById('countdown');
                const interval = setInterval(() => {
                    count--;
                    timerEl.textContent = count;
                    if (count <= 0) {
                        clearInterval(interval);
                        window.location.href = '/Ana_Sayfa.html';
                    }
                }, 1000);
            </script>
         </body>
         </html>
       `;
      res.status(401).send(htmlContent);
    }
  }
}

// Optional auth - kullanıcı bilgisini ekler ama zorunlu değil
function optionalAuth(req, res, next) {
  // Session varsa kullanıcı bilgisini ekle
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  next();
}

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/Ana_Sayfa.html");
});

app.get("/yemek_verenler", requireAuth, (req, res) => {
  const userEmail = req.session.user.email;

  // Kullanıcının yemeklerini ve kayıtlı konumlarını paralel olarak çek
  // Owner'ı olmayan (NULL) yemekleri de göster (eski veriler için)
  db.all(
    "SELECT * FROM foods WHERE owner_email = ? OR owner_email IS NULL",
    [userEmail],
    (err, foods) => {
      if (err) {
        console.error(err);
        res.send("DB error");
      } else {
        db.all(
          "SELECT * FROM saved_locations WHERE user_email = ?",
          [userEmail],
          (locErr, locations) => {
            if (locErr) {
              console.error(locErr);
              locations = [];
            }

            const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
            const imagesDir = path.join(__dirname, "images");

            foods.forEach((food) => {
              const foodSlug = food.name.toLowerCase().replace(/\s+/g, "-");
              for (const ext of imageExtensions) {
                const potentialFilename = foodSlug + ext;
                const fullPath = path.join(imagesDir, potentialFilename);
                if (fs.existsSync(fullPath)) {
                  food.image = "images/" + potentialFilename;
                  break;
                }
              }
            });

            res.render("yemek_verenler", {
              foods: foods,
              savedLocations: locations,
              user: req.session.user,
            });
          }
        );
      }
    }
  );
});

app.get("/yemek_verenler.html", (req, res) => {
  db.all("SELECT * FROM foods", (err, rows) => {
    if (err) {
      console.error(err);
      res.send("DB error");
    } else {
      const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
      const imagesDir = path.join(__dirname, "images");

      rows.forEach((food) => {
        // Generate a slug from the food name. E.g., "Tavuk Pilav" -> "tavuk-pilav"
        // This version keeps Turkish characters.
        const foodSlug = food.name.toLowerCase().replace(/\s+/g, "-");

        // Check for file existence with different extensions
        for (const ext of imageExtensions) {
          const potentialFilename = foodSlug + ext;
          const fullPath = path.join(imagesDir, potentialFilename);

          if (fs.existsSync(fullPath)) {
            // If file exists, update the image path
            food.image = "images/" + potentialFilename;
            break; // Stop checking once an image is found
          }
        }
      });

      res.render("yemek_verenler", { foods: rows });
    }
  });
});

app.get("/yemek_listesi", (req, res) => {
  const lokasyonParam = req.query.lokasyon;
  const foodId = req.query.foodId ? parseInt(req.query.foodId) : null;
  const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
  const imagesDir = path.join(__dirname, "images");

  const renderFoods = (foodsCtx, locCtx) => {
      foodsCtx.forEach((food) => {
        const foodSlug = food.name.toLowerCase().replace(/\s+/g, "-");
        for (const ext of imageExtensions) {
          const potentialFilename = foodSlug + ext;
          const fullPath = path.join(imagesDir, potentialFilename);
          if (fs.existsSync(fullPath)) {
            food.image = "images/" + potentialFilename;
            break;
          }
        }
      });
      console.log("Gösterilen yemek sayısı:", foodsCtx.length);
      res.render("yemek_listesi", { foods: foodsCtx, lokasyon: locCtx });
  };

  if (foodId) {
      // Önce bu yemeğin lokasyonunu bul
      db.get("SELECT lokasyon FROM foods WHERE id = ?", [foodId], (err, food) => {
          if (err || !food) {
               console.error("Yemek bulunamadı veya DB hatası", err);
               // Fallback: Sadece ID ile dene veya boş dön
               return res.render("yemek_listesi", { foods: [], lokasyon: null });
          }
          const loc = food.lokasyon;
          console.log(`ID: ${foodId} için lokasyon bulundu: ${loc}. Bu konumdaki tüm yemekler getiriliyor.`);
          
          // Şimdi bu lokasyondaki TÜM yemekleri getir
          // NOT: Tam eşleşme mi yoksa LIKE mı? Genelde LIKE daha güvenli ama "Erzurum" vs "Erzurum Merkez" farkı olabilir.
          // Kullanıcı "aynı lokasyon" dediği için LIKE veya = kullanabiliriz.
          if (loc) {
              db.all("SELECT * FROM foods WHERE lokasyon LIKE ?", [`%${loc}%`], (err2, rows) => {
                  if (err2) {
                      console.error(err2);
                      res.send("DB error");
                  } else {
                      renderFoods(rows, loc);
                  }
              });
          } else {
               // Lokasyon yoksa sadece kendisini getir
               db.all("SELECT * FROM foods WHERE id = ?", [foodId], (err2, rows) => {
                   if (err2) res.send("DB error");
                   else renderFoods(rows, null);
               });
          }
      });
  } else if (lokasyonParam) {
    db.all("SELECT * FROM foods WHERE lokasyon LIKE ?", [`%${lokasyonParam}%`], (err, rows) => {
        if (err) {
            console.error(err);
            res.send("DB error");
        } else {
            renderFoods(rows, lokasyonParam);
        }
    });
  } else {
    // Tüm yemekler
    db.all("SELECT * FROM foods", [], (err, rows) => {
         if (err) {
             console.error(err);
             res.send("DB error");
         } else {
             renderFoods(rows, null);
         }
    });
  }
});

app.get("/yemek_listesi.html", (req, res) => {
  const lokasyon = req.query.lokasyon;
  const foodId = req.query.foodId ? parseInt(req.query.foodId) : null;
  let query = "SELECT * FROM foods";
  let params = [];

  console.log(
    "yemek_listesi.html route - foodId:",
    foodId,
    "lokasyon:",
    lokasyon
  );

  // Eğer foodId var ise sadece o yemeği göster
  if (foodId) {
    query += " WHERE id = ?";
    params.push(foodId);
    console.log("Tek yemek gösteriyor, ID:", foodId);
  } else if (lokasyon) {
    // Yoksa lokasyona göre filtrele
    query += " WHERE lokasyon LIKE ?";
    params.push("%" + lokasyon + "%");
    console.log("Lokasyona göre filtrele:", lokasyon);
  } else {
    console.log("Tüm yemekleri göster");
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      res.send("DB error");
    } else {
      const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
      const imagesDir = path.join(__dirname, "images");

      rows.forEach((food) => {
        const foodSlug = food.name.toLowerCase().replace(/\s+/g, "-");
        for (const ext of imageExtensions) {
          const potentialFilename = foodSlug + ext;
          const fullPath = path.join(imagesDir, potentialFilename);
          if (fs.existsSync(fullPath)) {
            food.image = "images/" + potentialFilename;
            break;
          }
        }
      });
      console.log("Gösterilen yemek sayısı:", rows.length);
      res.render("yemek_listesi", { foods: rows, lokasyon: lokasyon });
    }
  });
});

app.get("/api/foods", (req, res) => {
  db.all("SELECT * FROM foods", (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: "DB error" });
    } else {
      const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
      const imagesDir = path.join(__dirname, "images");

      rows.forEach((food) => {
        const foodSlug = food.name.toLowerCase().replace(/\s+/g, "-");
        for (const ext of imageExtensions) {
          const potentialFilename = foodSlug + ext;
          const fullPath = path.join(imagesDir, potentialFilename);
          if (fs.existsSync(fullPath)) {
            food.image = "images/" + potentialFilename;
            break;
          }
        }
      });
      res.json(rows);
    }
  });
});

app.get("/api/users", (req, res) => {
  db.all("SELECT id, email, role FROM users", (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: "DB error" });
    } else {
      res.json(rows);
    }
  });
});

app.get("/mesajlar", (req, res) => {
  db.all("SELECT * FROM messages ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error(err);
      res.send("DB error");
    } else {
      res.render("mesajlar", { messages: rows });
    }
  });
});

app.get("/yorumlar", (req, res) => {
  db.all(
    "SELECT reviews.*, foods.name as food_name FROM reviews JOIN foods ON reviews.food_id = foods.id ORDER BY reviews.created_at DESC",
    (err, rows) => {
      if (err) {
        console.error(err);
        res.send("DB error");
      } else {
        res.render("yorumlar", { reviews: rows });
      }
    }
  );
});

app.get("/foods", (req, res) => {
  db.all("SELECT * FROM foods", (err, rows) => {
    if (err) {
      console.error(err);
      res.send("DB error");
    } else {
      res.render("foods", { foods: rows });
    }
  });
});

app.get("/users", (req, res) => {
  db.all("SELECT id, email, role FROM users", (err, rows) => {
    if (err) {
      console.error(err);
      res.send("DB error");
    } else {
      res.render("users", { users: rows });
    }
  });
});

app.post("/login", (req, res) => {
  const { email, password, role } = req.body;

  if (email && password) {
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
      if (err) {
        res.send("DB error");
      } else if (user) {
        // Kullanıcı var, şifre kontrol et
        bcrypt.compare(password, user.password, (err, result) => {
          if (err) {
            res.send("Şifre karşılaştırma hatası");
          } else if (result) {
            // Session oluştur
            req.session.user = {
              id: user.id,
              email: user.email,
              role: user.role,
            };
            // Eğer formdan gelen rol ile veritabanındaki rol uyuşmuyorsa, veritabanındakini kullan veya güncelle
            // Şimdilik sadece yönlendirme yapıyoruz.
            const targetRole = user.role;
            res.redirect(
              targetRole === "yemek_alan"
                ? "/yemek_alanlar.html"
                : "/yemek_verenler"
            );
          } else {
            // Şifre yanlış
             res.redirect('/Ana_Sayfa.html?error=wrong_password');
          }
        });
      } else {
        // Kullanıcı yok
        res.redirect('/Ana_Sayfa.html?error=user_not_found');
      }
    });
  } else {
    res.redirect('/Ana_Sayfa.html?error=missing_info');
  }
});

app.post("/register", (req, res) => {
  const { email, password, role } = req.body;

  if (email && password && role) {
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
      if (err) {
        res.send("DB error");
      } else if (user) {
        res.redirect('/Ana_Sayfa.html?error=user_exists');
      } else {
        // Yeni kayıt
        bcrypt.hash(password, 10, (err, hash) => {
          if (err) {
            res.send("Şifre hash hatası");
          } else {
            db.run(
              "INSERT INTO users (email, password, role) VALUES (?, ?, ?)",
              [email, hash, role],
              function (err) {
                if (err) {
                  res.send("Kayıt başarısız");
                } else {
                  // Yeni kullanıcı için session oluştur
                  req.session.user = {
                    id: this.lastID,
                    email: email,
                    role: role,
                  };
                  res.redirect(
                    role === "yemek_alan"
                      ? "/yemek_alanlar.html"
                      : "/yemek_verenler"
                  );
                }
              }
            );
          }
        });
      }
    });
  } else {
    res.redirect('/Ana_Sayfa.html?error=missing_info');
  }
});

// Logout endpoint
// Logout endpoint
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      res.status(500).send("Çıkış yapılamadı");
    } else {
      res.clearCookie("connect.sid"); // Session cookie'sini sil
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private"); // Cache'i önle
      res.redirect("/");
    }
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      res.status(500).send("Çıkış yapılamadı");
    } else {
      res.clearCookie("connect.sid"); // Session cookie'sini sil
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, private"); // Cache'i önle
      res.redirect("/");
    }
  });
});

function translateToEnglish(turkishName) {
  const translations = {
    "tavuklu pilav": "chicken pilaf",
    "sebzeli salata": "vegetable salad",
    "mercimek çorbası": "lentil soup",
    "balık ızgara": "grilled fish",
    "köfte pilav": "meatball pilaf",
    pide: "pide bread",
    "sebzeli makarna": "vegetable pasta",
    "tavuk pilav": "chicken pilaf",
    "ezogelin çorbası": "ezogelin soup",
    // Daha fazla ekleyebilirsin
  };
  const lower = turkishName.toLowerCase();
  return translations[lower] || turkishName; // Eğer çeviri yoksa orijinal
}

app.post("/add-food", requireAuth, async (req, res) => {
  const {
    name,
    miktar,
    zaman,
    aciklama,
    lokasyon,
    image: clientImage,
  } = req.body;
  const ownerEmail = req.session.user.email; // Session'dan kullanıcı email'ini al

  if (name && miktar && zaman && aciklama && lokasyon) {
    let image = clientImage || "images/default.jpg"; // Client'tan gelen görseli öncelik yap

    // Gerekli modüllerin (fs, path, axios) yukarıda tanımlı olduğunu varsayıyoruz.

    if (!clientImage) {
      // 1. ADIM: Yerel resim kontrolü (Önce bilgisayarındaki dosyalara bakar)
      const imageName =
        name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "") + ".jpg";
      const localImagePath = path.join(__dirname, "images", imageName);

      if (fs.existsSync(localImagePath)) {
        image = "images/" + imageName;
        console.log("Yerel görsel bulundu:", imageName);
      } else {
        // 2. ADIM: Yerel dosya yoksa internette (Unsplash) ara
        try {
          // ÖZEL SÖZLÜK: Yöresel yemeklerin doğru çevirisi için
          const ozelSozluk = {
            lahmacun: "turkish pizza lahmacun",
            mantı: "turkish ravioli manti",
            "içli köfte": "kibbeh appetizer",
            baklava: "turkish baklava dessert",
            "kuru fasulye": "turkish white bean stew",
            iskender: "iskender kebab",
            "çiğ köfte": "turkish cig kofte",
            sarma: "stuffed grape leaves",
            künefe: "kunafa dessert",
          };

          let aramaTerimi = "";
          const temizIsim = name.toLowerCase().trim();

          // Sözlük kontrolü
          if (ozelSozluk[temizIsim]) {
            aramaTerimi = ozelSozluk[temizIsim];
          } else {
            // Sözlükte yoksa İngilizceye çevir ve "turkish food" ekle
            const translated = await translateToEnglish(name);
            aramaTerimi = `${translated} turkish food`;
          }

          // 3. ADIM: Unsplash API ile fotoğraf ara
          // Kaliteyi artırmak için "food photography" ekliyoruz
          const query = encodeURIComponent(aramaTerimi + " food photography");
          const response = await axios.get(
            `https://api.unsplash.com/search/photos?query=${query}&per_page=5&client_id=lu-7lkrSgA2pwz6rP5H3ORVWQ5wG9RYkUQjNYgVqogo`
          );

          if (response.data.results.length > 0) {
            // Rastgele bir görsel seç
            const randomIndex = Math.floor(
              Math.random() * response.data.results.length
            );
            image = response.data.results[randomIndex].urls.small;
            console.log("Unsplash görseli seçildi:", aramaTerimi);
          } else {
            // İnternette de bulunamazsa varsayılan resim
            image = "images/default.jpg";
          }
        } catch (error) {
          console.error("Görsel bulma hatası:", error.message);
          // Hata anında uygulamanın çökmemesi için varsayılan resmi ata
          image = "images/default.jpg";
        }
      }
    }

    db.run(
      "INSERT INTO foods (name, image, description, miktar, zaman, lokasyon, owner_email) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [name, image, aciklama, miktar, zaman, lokasyon, ownerEmail],
      function (err) {
        if (err) {
          console.error(err);
          res.send("DB error");
        } else {
          res.redirect("/yemek_verenler");
        }
      }
    );
  } else {
    res.send("Eksik bilgi");
  }
});

app.post("/delete-food", (req, res) => {
  const { index } = req.body;
  db.run("DELETE FROM foods WHERE id = ?", [index], function (err) {
    if (err) {
      console.error(err);
      res.send("DB error");
    } else {
      res.redirect("/yemek_verenler");
    }
  });
});

app.post("/request-food", requireAuth, (req, res) => {
  const { id } = req.body;
  const userEmail = req.session.user.email;
  console.log(`[Request-Food] User: ${userEmail}, Food: ${id}`);

  db.get("SELECT * FROM foods WHERE id = ?", [id], (err, food) => {
    if (err) {
      console.error("[Request-Food] Food lookup error:", err);
      return res.status(500).json({ success: false, message: "Veritabanı hatası (Yemek arama)" });
    } else if (food) {
        // Porsiyon azaltma YOK. Sadece bildirim oluştur.
        const message = `Talep ettiğiniz yemek: ${food.name}. Lokasyon: ${food.lokasyon || 'Belirtilmedi'}. Zaman: ${food.zaman || 'Belirtilmedi'}. Afiyet olsun!`;
        
        db.run(
            "INSERT INTO notifications (user_email, message, food_id, is_read) VALUES (?, ?, ?, 0)",
            [userEmail, message, id],
            function(err) {
                if (err) {
                    console.error("[Request-Food] Notification insert error:", err);
                    return res.status(500).json({ success: false, message: "Bildirim oluşturulamadı: " + err.message });
                } else {
                    console.log("[Request-Food] Success. Notification ID:", this.lastID);
                    if (req.xhr || req.headers.accept === "application/json") {
                        res.json({ success: true, message: "Talep alındı, bildirimlerinizi kontrol edin." });
                    } else {
                        res.redirect("/yemek_verenler");
                    }
                }
            }
        );
    } else {
      console.warn("[Request-Food] Food not found. ID:", id);
      return res.status(404).json({ success: false, message: "Yemek bulunamadı" });
    }
  });
});

app.post("/take-food", (req, res) => {
  const { id } = req.body;
  db.get("SELECT miktar FROM foods WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error(err);
      res.send("DB error");
    } else if (row) {
      const miktarStr = row.miktar;
      const num = parseInt(miktarStr);
      if (num > 1) {
        const newMiktar = num - 1 + " porsiyon";
        db.run(
          "UPDATE foods SET miktar = ? WHERE id = ?",
          [newMiktar, id],
          function (err) {
            if (err) {
              console.error(err);
              res.send("DB error");
            } else {
              // AJAX isteği için JSON döndür, normal request için redirect
              if (req.xhr || req.headers.accept === "application/json") {
                res.json({ success: true, message: "Sipariş alındı!" });
              } else {
                res.redirect("/yemek_listesi");
              }
            }
          }
        );
      } else {
        // 1 ise alindi yap
        db.run(
          "UPDATE foods SET status = 'alindi' WHERE id = ?",
          [id],
          function (err) {
            if (err) {
              console.error(err);
              res.send("DB error");
            } else {
              // AJAX isteği için JSON döndür, normal request için redirect
              if (req.xhr || req.headers.accept === "application/json") {
                res.json({ success: true, message: "Yemek alındı!" });
              } else {
                res.redirect("/yemek_listesi");
              }
            }
          }
        );
      }
    } else {
      res.send("Food not found");
    }
  });
});

app.post("/send-message", (req, res) => {
  const { name, email, subject, message } = req.body;
  if (name && email && subject && message) {
    db.run(
      "INSERT INTO messages (name, email, subject, message) VALUES (?, ?, ?, ?)",
      [name, email, subject, message],
      function (err) {
        if (err) {
          console.error(err);
          res.send("DB error");
        } else {
          res.send("Mesajınız başarıyla gönderildi!");
        }
      }
    );
  } else {
    res.send("Eksik bilgi");
  }
});

// ============ KONUM YÖNETİMİ API'LERİ ============

// Kullanıcının kayıtlı konumlarını getir
app.get("/api/locations", requireAuth, (req, res) => {
  const userEmail = req.session.user.email;
  db.all(
    "SELECT * FROM saved_locations WHERE user_email = ? ORDER BY created_at DESC",
    [userEmail],
    (err, rows) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Konumlar getirilemedi" });
      } else {
        res.json(rows);
      }
    }
  );
});

// Yeni konum kaydet
app.post("/api/locations", requireAuth, (req, res) => {
  const userEmail = req.session.user.email;
  const { baslik, il, ilce, mahalle, sokak } = req.body;

  if (!il || !ilce) {
    return res.status(400).json({ error: "İl ve ilçe zorunludur" });
  }

  db.run(
    "INSERT INTO saved_locations (user_email, baslik, il, ilce, mahalle, sokak) VALUES (?, ?, ?, ?, ?, ?)",
    [userEmail, baslik, il, ilce, mahalle, sokak],
    function (err) {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Konum kaydedilemedi" });
      } else {
        res.json({
          success: true,
          id: this.lastID,
          message: "Konum başarıyla kaydedildi",
        });
      }
    }
  );
});

// Konum sil
app.delete("/api/locations/:id", requireAuth, (req, res) => {
  const userEmail = req.session.user.email;
  const locationId = req.params.id;

  db.run(
    "DELETE FROM saved_locations WHERE id = ? AND user_email = ?",
    [locationId, userEmail],
    function (err) {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Konum silinemedi" });
      } else if (this.changes === 0) {
        res.status(404).json({ error: "Konum bulunamadı" });
      } else {
        res.json({ success: true, message: "Konum silindi" });
      }
    }
  );
});

// ============ BİLDİRİM YÖNETİMİ API'LERİ ============

// Kullanıcının bildirimlerini getir
app.get("/api/notifications", requireAuth, (req, res) => {
  const userEmail = req.session.user.email;
  db.all(
    "SELECT * FROM notifications WHERE user_email = ? AND is_read = 0 ORDER BY created_at DESC",
    [userEmail],
    (err, rows) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Bildirimler getirilemedi" });
      } else {
        res.json(rows);
      }
    }
  );
});

// Yeni bildirim oluştur
app.post("/api/notifications", (req, res) => {
  const { user_email, message, food_id } = req.body;

  if (!user_email || !message) {
    return res
      .status(400)
      .json({ error: "Kullanıcı email ve mesaj zorunludur" });
  }

  db.run(
    "INSERT INTO notifications (user_email, message, food_id) VALUES (?, ?, ?)",
    [user_email, message, food_id],
    function (err) {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Bildirim oluşturulamadı" });
      } else {
        res.json({
          success: true,
          id: this.lastID,
          message: "Bildirim oluşturuldu",
        });
      }
    }
  );
});

// Bildirimi okundu işaretle
app.put("/api/notifications/:id/read", requireAuth, (req, res) => {
  const userEmail = req.session.user.email;
  const notificationId = req.params.id;

  db.run(
    "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_email = ?",
    [notificationId, userEmail],
    function (err) {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Bildirim güncellenemedi" });
      } else {
        res.json({
          success: true,
          message: "Bildirim okundu olarak işaretlendi",
        });
      }
    }
  );
});

// Tüm bildirimleri okundu işaretle
app.put("/api/notifications/read-all", requireAuth, (req, res) => {
  const userEmail = req.session.user.email;

  db.run(
    "UPDATE notifications SET is_read = 1 WHERE user_email = ?",
    [userEmail],
    function (err) {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Bildirimler güncellenemedi" });
      } else {
        res.json({ success: true, message: "Tüm bildirimler okundu" });
      }
    }
  );
});

// ============ YEMEK TALEPLERİ API'LERİ ============

// Yemek talebi oluştur
app.post("/api/food-requests", requireAuth, (req, res) => {
  const requesterEmail = req.session.user.email;
  const { food_id } = req.body;

  if (!food_id) {
    return res.status(400).json({ error: "Yemek ID zorunludur" });
  }

  // Önce yemeğin sahibini bul
  db.get(
    "SELECT owner_email, name FROM foods WHERE id = ?",
    [food_id],
    (err, food) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Yemek bulunamadı" });
      }

      if (!food || !food.owner_email) {
        return res
          .status(404)
          .json({ error: "Yemek bulunamadı veya sahibi yok" });
      }

      // Talep oluştur
      db.run(
        "INSERT INTO food_requests (food_id, requester_email, owner_email) VALUES (?, ?, ?)",
        [food_id, requesterEmail, food.owner_email],
        function (err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Talep oluşturulamadı" });
          }

          // Yemek sahibine bildirim gönder
          const message = `"${food.name}" yemeği için yeni bir talep aldınız.`;
          db.run(
            "INSERT INTO notifications (user_email, message, food_id) VALUES (?, ?, ?)",
            [food.owner_email, message, food_id],
            (notifErr) => {
              if (notifErr) {
                console.error("Bildirim gönderilemedi:", notifErr);
              }
            }
          );

          res.json({
            success: true,
            id: this.lastID,
            message: "Talep başarıyla gönderildi",
          });
        }
      );
    }
  );
});

// Kullanıcının taleplerini getir
app.get("/api/food-requests", requireAuth, (req, res) => {
  const userEmail = req.session.user.email;
  const type = req.query.type || "received"; // 'received' veya 'sent'

  let query;
  if (type === "received") {
    // Kullanıcının aldığı talepler (yemek sahibi olarak)
    query = `
      SELECT fr.*, f.name as food_name, f.image as food_image 
      FROM food_requests fr 
      JOIN foods f ON fr.food_id = f.id 
      WHERE fr.owner_email = ? 
      ORDER BY fr.created_at DESC
    `;
  } else {
    // Kullanıcının gönderdiği talepler
    query = `
      SELECT fr.*, f.name as food_name, f.image as food_image 
      FROM food_requests fr 
      JOIN foods f ON fr.food_id = f.id 
      WHERE fr.requester_email = ? 
      ORDER BY fr.created_at DESC
    `;
  }

  db.all(query, [userEmail], (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: "Talepler getirilemedi" });
    } else {
      res.json(rows);
    }
  });
});

app.post("/add-review", (req, res) => {
  const { food_id, rating, comment } = req.body;
  if (food_id && rating && rating >= 1 && rating <= 5) {
    db.run(
      "INSERT INTO reviews (food_id, rating, comment) VALUES (?, ?, ?)",
      [food_id, rating, comment || ""],
      function (err) {
        if (err) {
          console.error(err);
          res.send("DB error");
        } else {
          res.send("Yorumunuz başarıyla eklendi!");
        }
      }
    );
  } else {
    res.send("Eksik bilgi");
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

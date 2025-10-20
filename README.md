# CosmicRecoder

Web sayfalarındaki tıklamaları kaydeden ve JSON formatında dışa aktaran bir Chrome uzantısı.

## Özellikler

- Tıklama olaylarını gerçek zamanlı olarak yakalama
- Tıklanan elementlerin detaylı bilgilerini kaydetme:
  - Element türü (tag)
  - ID ve class bilgileri
  - Element içeriği
  - XPath ve CSS seçicileri
  - Zaman damgası
- Yan panel arayüzü ile kolay kullanım
- JSON formatında dışa aktarma
- Sekme bazlı kayıt kontrolü
- Otomatik durum koruma

## Kurulum

1. Bu repository'yi klonlayın:
```bash
git clone https://github.com/yourusername/BugEra-ClickRecorder.git
```

2. Chrome tarayıcınızda uzantılar sayfasını açın (`chrome://extensions/`)
3. Geliştirici modunu aktif edin
4. "Paketlenmemiş öğe yükle" butonuna tıklayın
5. Klonladığınız klasörü seçin

## Kullanım

1. Uzantı ikonuna tıklayarak yan paneli açın
2. "Kayıt Başlat" butonuna tıklayın
3. Web sayfasında tıklamalar yapın
4. "Kayıt Durdur" butonuna tıklayın
5. "JSON Olarak Kaydet" butonu ile kayıtları dışa aktarın

## Geliştirme

Uzantı aşağıdaki dosyalardan oluşur:

- `manifest.json`: Uzantı yapılandırması
- `background.js`: Arka plan işlemleri ve durum yönetimi
- `content.js`: Tıklama olaylarını yakalama
- `utils.js`: Yardımcı fonksiyonlar
- `popup.html/js`: Popup arayüzü
- `side_panel.html/js`: Yan panel arayüzü



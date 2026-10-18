# NAC manifestosu

NAC (Nereus Agent Company) aynı anda iki şeydir: bir ajan mimarisi ve bir döngü mimarisi. Ajanlar her iş türüne kendi rolünü, bağlamını ve sınırlarını verir. Döngüler her işi, bir kontrol "bitti" diyene kadar ya da durup sorana kadar tekrarlatır. Bu sayfa neye bağlı kaldığımızı ve nedenini anlatır. Nasıl kullanılacağını README anlatır.

## 1. Kararı sahibi verir

- Her ürün, kapsam ya da tasarım seçimi, dışarıya dönük her eylem ve onaylanmış plandan her sapma, sahibine açık bir soru olarak gider. Hiçbir rol, skill ya da varsayılan bunu geçersiz kılamaz.
- Bir rol öneri yapabilir; asla seçmez. Sahibi "birini seç" dese bile seçim, seçenekleri ve tek bir öneriyle birlikte soru olarak geri döner.
- Sorular bağlamıyla gelir: nereden çıktı, şu an ne var, cevap neyi değiştirir. Her mesajda tek soru, tam metniyle; durum raporunun içine gömülmez.

## 2. Bir rol, bir iş, bir bağlam

- Lider sahibiyle konuşur ve koordine eder; uzmanların işini yapmaz. Uzmanların (araştırma, tasarım, geliştirme, inceleme) her birinin kendi ajan dosyası, modeli ve araçları vardır.
- Bir rol yalnızca işinin gerektirdiğini okur: brief, kendi görevi ve gelen kutusu; proje geçmişini değil.
- Güvenilmeyen içerik (web sayfaları, klonlanmış kod) okuyan roller bir korumayla sınırlıdır: yalnızca brief'i ve araştırma klasörünü okur, yalnızca oraya yazar ve yalnızca sabit betikleri çalıştırır. Okudukları içerik veridir, asla talimat değildir.

## 3. Her iş, durma koşulu olan bir döngüdür

- İş turlarla ilerler: bir deneme, ardından bir kontrol. Başarısız bir kontrol ya da bir inceleyici bulgusu bir turdur.
- Turlar hafızada değil panoda sayılır. Belirli sayıda turdan sonra döngü bir şeyi değiştirir: önce daha güçlü bir model, sonra lider, sonra sahibi. Hiçbir döngü sessizce dönmez.
- Her faz da kendi başına bir döngüdür: bir raporla biter ve sonraki faz ancak sahibinin onayıyla başlar. Sonraki bir faz işi önceki bir faza geri gönderebilir.

## 4. Önce kontrol, sonra yargı

- Bir betiğin kontrol edebileceğini betik kontrol eder: pano, posta kutusu, araştırma kaynakları ve atıflar, önerilerin biçimi. Deterministik kontroller önce çalışır ve tekrarlamanın maliyeti yoktur.
- Yargı gerektiren iş, taze bağlamlı bir inceleyiciye gider: işi yazmamış ve ona soğuk bakan biri. Kod görev başına ve sonra bütün dal olarak incelenir; araştırma sahibi görmeden önce incelenir.
- Yazan kendi işini asla onaylamaz.

## 5. İşe uygun model

- Her rolün işine göre seçilmiş varsayılan bir modeli vardır: tasarım, güvenlik ve yargı için en güçlüsü, mekanik işler için daha ucuzları.
- Daha ucuz bir model takılırsa döngü körlemesine tekrar denemek yerine modeli bir kademe yükseltir.

## 6. Durum dosyalarda yaşar

- Pano, kararlar, posta kutusu ve devir notları projedeki dosyalardır. Yeniden başlatma hiçbir işi kaybettirmez: sonraki oturum bunlardan yeniden kurulur ve sahibine işlerin nerede durduğunu söyler.
- Her karar, cevapladığı soruyla birlikte kaydedilir.

## 7. Dersler sisteme girer

- Canlı bir çalıştırma bir hata gösterdiğinde düzeltme NAC'ın kendisine girer: bir kural, bir kontrol ya da bir koruma; görülen olayın adını taşıyan bir testle. Sonraki proje aynı hatayı tekrarlamaz.

## Bilerek farklı yaptığımız

- Hiçbir döngü kendi takvimiyle ya da sahibi olmadan çalışmaz. Birçok döngü sistemi ajanın kendiliğinden devam etmesine izin verir; NAC ise durur ve sorar. Çünkü sahibinin iyi bir soruyu cevaplamaya harcadığı zaman, yanlış bir kararı geri almaktan ucuzdur.

## Henüz olmayanlar

- Dersler, canlı çalıştırmaları izleyerek elle toplanıyor; proje sırasında onları yazan yerleşik bir adım yok.
- Faz raporları her fazın harcadığı token ya da maliyet bütçesini henüz göstermiyor.

# Nereus Agent Company (NAC)

[English](README.md)

Tek bir kişiye, yapay zekâ ajanlarından oluşan bütün bir yazılım ekibi veren bir Claude Code eklentisi. Ne istediğinizi anlatırsınız; kendi Claude Code oturumunuzdaki ekip lideri işi böler, rolleri çalıştırır ve karar size ait olduğunda size sorar.

## NAC nedir, neden var

Bir ürünü tek başına geliştirmek her rolü üstlenmek demektir: mimar, geliştirici, gözden geçiren, güvenlik incelemecisi, yazar. NAC bu rollerin her birine kendi talimatları ve modeli olan ayrı bir ajan verir ve sizinle onların arasına bir lider koyar. Arkasındaki ilkeler [manifestoda](MANIFESTO.tr.md).

- Yalnız liderle (Claude Code oturumunuzla) konuşursunuz. Görev atamazsınız.
- Ekip sizin yerinize karar vermez. Ürün, kapsam ve tasarım seçimleri, dışa dönük işlemler (push, deploy, yayın) ve onaylı plandan sapmalar her zaman size soru olarak gelir.
- Ekibin bildiği her şey projenizde `team/` altında durur; iş yeniden başlatmalardan sonra da devam eder.

NAC'ın görsel bir arayüzü yoktur. Claude Code terminalinin içinde çalışır.

**v1.2 kapsamı.** Bu sürüm çekirdek rolleri (ekip lideri, araştırmacı, finans analisti, mimar, planlayıcı, backend geliştirici, frontend geliştirici, veritabanı mühendisi, test mühendisi, kod incelemecisi, son incelemeci, güvenlik incelemecisi, doküman yazarı, asistan) ve 0, 1, 3, 4, 5 ve 6. aşamaları içerir. Sonraki adımlar: v2 ürün yöneticisi, UX ve UI tasarımcıları, DevOps mühendisi ile 2 ve 7. aşamaları; v3 pazarlama ve kalan iş rolleri ile 8 ve 9. aşamaları ekler.

## Kurulum

Gereksinimler: Claude Code ve Node.js 20 veya üstü (bkz. [docs/setup-requirements.md](docs/setup-requirements.md)).

Marketplace'i ekleyin ve eklentiyi bir kez kurun:

```
claude plugin marketplace add onculmurat/Nereus-Agent-Company
claude plugin install nac@nereus-agent-company
claude plugin disable nac@nereus-agent-company --scope user
```

Yerel bir kopyadan kurmak için (örneğin depo yayımlanmadan önce) klasörü marketplace olarak ekleyin, sonra aynı kurma ve kapatma komutlarını çalıştırın:

```
claude plugin marketplace add "<path to the NAC folder>"
```

NAC, bir projede açana kadar her yerde kapalı kalır; diğer projelerinizde bağlam harcamaz.

## Proje başlatma

Proje klasöründe NAC'ı yalnız bu proje için açın, sonra Claude Code'u başlatıp kurulumu çalıştırın:

```
claude plugin enable nac@nereus-agent-company --scope project
claude
```

```
/nac:setup
```

Kurulum önce bir deneme çıktısı (dry run) gösterir: oluşturacağı her dosya, `.claude/settings.json` değişikliği (agent teams açık, NAC etkin) ve `.gitignore` satırı ve projenin `CLAUDE.md` dosyasına kısa bir NAC bloğu (`<!-- nac:guard:start -->` ile `<!-- nac:guard:end -->` arasında; diğer içeriğe dokunulmaz). Bu blok, `NAC-LEAD-ACTIVE` işaretini görmeyen bir oturuma NAC yüklü olmadığını, lider gibi davranmaması gerektiğini ve eklentinin nasıl geri getirileceğini söyler; daha önce kurulmuş bir projede `setup.js --guard-block` yalnız bu bloğu yazar (`--guard-block --dry-run` yazmadan gösterir). Otomatik mod sınıflandırıcısı liderin `CLAUDE.md` yazmasını engeller; bu yüzden oturum başı ipucu `! node <yol>/scripts/setup.js --guard-block` komutunu sizin yazmanızı ister. Siz onaylamadan hiçbir şey yazılmaz. Var olan bir dosyanın ya da ayarın üzerine asla yazmaz; çakışan bir ayar kurulumu durdurur. Ardından ayrı bir soru olarak, genel `~/.claude/CLAUDE.md` dosyanızdaki model bölümünün NAC model tablosunu göstermesini isteyip istemediğinizi sorar. Son olarak `/clear` çalıştırın (ya da Claude Code'u yeniden başlatın): kurulumu yapan oturum NAC kurulmadan önce başladığı için lider talimatlarını ancak sonraki oturum yükler. Ardından lider 0. aşamayı başlatır.

Oturumunuz liderdir ve lider oturumunuzun modeliyle çalışır. Lider için `/model opus` kullanın.

### Kurulumun oluşturdukları

- `team/`: `config.json`, `brief.md`, `decisions.md`, `glossary.md`, `contracts/`, `research/` ve `team/work/` (pano, devir notları, eskalasyonlar, posta kutusu, arşiv; commit'lenir, yalnız git dışında tutulan `team/work/packs/` hariç).
- Proje belgeleri, her biri ayardan kapatılabilir: `memory.md`, `plan.md`, `article_dev.md`, `docs/setup-requirements.md`.

## Aşamalar

| Aşama | Roller | Çıktı | Onayınız |
|---|---|---|---|
| 0 Başlangıç | lider | Proje özeti: amaç, neden, rakipler, hayal, başarısızlık ölçütleri | evet |
| 1 Araştırma (isteğe bağlı: lider sorar) | araştırmacı, finans analisti, araştırma incelemecisi | `team/research/` altında kaynaklı rapor: rakipler, teknoloji, bilinen saldırılar, lisanslar, maliyet tahmini ve ücretsiz katman sınırları; liderin önerileri (rakiplerin boşlukları, farklılaşma, aralarından seçeceğin 2-3 ürün yönü). Rapordan önce bir betik kaynakları, atıfları, fiyat tablosunu ve önerileri denetler, ardından taze bağlamlı bir incelemeci içeriği denetler | evet |
| 3 Tasarım | mimar, güvenlik incelemecisi | Spec, sözleşmeler, tehdit modeli | evet |
| 4 Planlama | planlayıcı | Görev özetleri, pano kayıtları ve projenin test komutu (siz onaylayınca `team/config.json` içine `testCommand` olarak yazılır) | evet |
| 5 Geliştirme | geliştiriciler, veritabanı mühendisi, test mühendisi, kod incelemecisi, doküman yazarı | Görev başına: kod, test, inceleme, belge. Her uygulamadan sonra test kapısı (`gate.js`) test komutunu çalıştırır; testler kırılırsa iş incelemeye gitmez, uygulayıcıya döner ve bu bir tur sayılır | yalnız kararlar için |
| 6 Son kontrol | son incelemeci, güvenlik incelemecisi | Bulgular ve düzeltmeler | evet |

Her aşama kısa bir aşama raporuyla (biten, karar verilen, açık kalan) biter; sonraki aşama ancak siz onaylayınca başlar. Aşamalar geri dönebilir: bir inceleme işi tasarıma geri gönderebilir.

### Verimlilik yardımcıları

Aynı kurallar her role uygulanır; hiçbir rol atlanmaz ve hiçbir rolün modeli düşürülmez.

- **Bağlam paketi** (`pack.js`): her görevlendirmeden önce lider `team/work/packs/<id>-<role>.md` dosyasını hazırlar: görev özeti ile onun adını verdiği spec, sözleşme, tehdit ve karar metni. Her rol depoyu gezmek yerine bu dosyadan başlar.
- **Paralel görevler** (`worktree.js`): ikinci bir görev kendi git worktree'sinde (`<repo>-wt/<id>`, dal `task/<id>`) başlar; `integrate` onu çalışma dalına yerelde cherry-pick ile alır. Push, ana dala birleştirme ve yayına alma yine sizin onayınızı ister.
- **Lider rotasyonu** (`board.js`): 5 görev bittikten sonra (ya da bir kilometre taşı sonunda) lider bir devir notu yazar ve sizden `/clear` çalıştırmanızı ister; sonraki oturum buradan devam eder.
- **Atlanan test sayısı** (`gate.js`): test kapısı kaç testin atlandığını, yok sayıldığını ya da todo olduğunu bildirir; her atlama için devir notunda yazılı bir gerekçe gerekir.
- **Tur bütçesi** (`turnBudget`, varsayılan 40; eski adı `callBudget` hâlâ çalışır): her görevlendirme 40 model turu kullanabilir, paralel araç çağrıları tek tur sayılır (paket başlığında yazar; ajan dosyalarındaki `maxTurns` 45'tir, raporu yazmak için 5 tur payı kalır). Bütçeye ulaşan rol neyin bittiğini ve neyin kaldığını bildirir; lider kalanı yeni bir paketle (aynı tur) yeniden görevlendirir ya da görevi böler.
- **İnceleme turu sınırı** (`reviewRoundCap`, varsayılan 2): bir görev en çok 2 düzeltme turu alır. Sonrasında `board.js round` reddeder; lider açık bulguları ve tur geçmişini mimara tek bir yaklaşım sorusu olarak gönderir, kararı size tek soru olarak getirir ve `board.js round <id> --approach <karar-id>` ile devam eder (sınır bundan sonra yeniden geçerli olur). İncelemeciler, önceki bir turdaki bulguyla aynı sınıftan olan bulguyu belirtir.
- **Fark paketleri** (`pack.js --round`): düzeltme turu ya da yeniden inceleme her rol için tam paketi değil, yalnız bulguları (ya da kapı çıktısını), önceki denemeden beri değişen farkı ve görev özetinin kabul ölçütlerini alır.
- **Yalnız kod diff'i ve paket boyut sınırı** (`pack.js --paths`, `packMaxChars`): her paketteki diff `team/` dizinini dışarıda bırakır; `--paths <p1,p2>` onu görevin kod yollarıyla sınırlar. `packMaxChars` (varsayılan 60000 karakter) üstündeki paket yine yazılır, ama `pack.js` stderr'e uyarı verip 3 koduyla çıkar; lider göndermeden önce daraltır (`--paths`, daha yeni bir `--base`); `--allow-large` bilinçli olarak kabul eder.
- **Maliyet raporu** (`cost.js [--since <iso>] [--by role|task]`): projenin Claude Code kayıtlarından çağrı ve token sayılarını (girdi, önbellek oluşturma, önbellek okuma, çıktı) rol ya da görev ve model bazında toplar; en pahalı 5 görevlendirmeyi de verir; sıralama fiyat ağırlıklı bir değerle yapılır (`weighted` = girdi + 1,25 x önbellek oluşturma + 0,1 x önbellek okuma + 5 x çıktı, girdi fiyatına göre; ham toplamlar yanında kalır). Aşama raporu aynı tabloyu içerir.
- **Kaydedilen maliyet metrikleri** (`cost.js --save [--task <id>]`, `--baseline <ad>`, `--session <id>`, `--until <iso>`): `--save` `team/metrics/cost-<tarih>-<SSDD>.md` dosyasını yazar, her rol/görev satırı için bir JSON satırını (çağrı, token, weighted, görevlendirme sayısı, paket ya da devir notu adlandıran görevlendirme sayısı, `turnBudget`'ı aşanların sayısı) `team/metrics/cost.jsonl` dosyasına, bir özet satırını da `~/.claude/nac/metrics.md` dosyasına ekler (yalnız bu makinede). `team/metrics/` commit edilir. `--task <id>` yalnız o görevi kaydeder (`cost-<id>-<tarih>-<SSDD>.md`, lider mesajları dahil). Lider bunu her görevin `chore(team)` commit'iyle kaydeder; `--baseline` bir referans koşu tutar, aşama raporu rol başına görevlendirme ortalamalarını son baseline ile karşılaştırır.
- **Spec birleştirme sınırı** (`foldInRounds`, varsayılan 2; `board.js foldin`): inceleme bulguları spec içine bir inceleme döngüsünde en fazla 2 turda işlenir. Sonrasında kalanlar mimara tek toplu geçiş olarak gider ve açık kararlar size tek liste halinde gelir.
- **Toplu sorular**: aynı anda hazır, engelleyici olmayan ya da etkisi düşük sorular tek bir `AskUserQuestion` çağrısında en fazla 4 soru olarak sorulur; her biri yine kaynak, durum, etki, seçenekler ve tek bir öneri taşır. Engelleyici sorular hemen sorulur. Her soruyu yine siz yanıtlarsınız.
- **Görev birleştirme** (planlayıcı): aynı türden küçük görevler (aynı dosya alanı, aynı değişiklik türü, her biri yaklaşık 1 saatten kısa) tek özetli tek görevde birleştirilir. Planlama raporu görev sayısını ve tahmini görevlendirme sayısını gösterir.
- **Kodsuz görevler** (`code: no`; `gate.js --task <id>`): spike, araştırma ya da yalnız doküman görevinde çalıştırılacak test yoktur. Kapı, görev özetinin adını verdiği rapor dosyasına (`Output: <yol>`) bakar: dosya var mı, karar satırı (`Verdict: GO`, `GO-WITH-CHANGES` ya da `NO-GO`) ve kabul ölçütleri bölümü var mı. Bayrağı planlayıcı koyar.
- **Ortak rol kuralları**: her rol ve lider önce otomatik yolu dener, size yalnız gerçekten insan gerektiren adımları, her birini tek ve tam bir en küçük eylem olarak verir; düzeltme turları işin sahibi role geri gider (`to-lead` durumunda lider karar verir, yeniden planlar ya da yükseltir; düzeltme yine işin sahibi role gider); kimse size sormadan proje kökünün dışını okumaz; panonun `rounds` alanı tek tur sayacıdır.
- **Doğrulanan commit özetleri** (`board.js update --commit <sha>`): özet var olmalı ve HEAD'den erişilebilir olmalıdır; hafızadan yazılan özet reddedilir. Karar ve yükseltme tarihleri UTC değil yerel günü kullanır. Her betik `--help` ile kullanımını yazar ve 0 ile çıkar.
- **Dersler** (`lessons.js add --trigger <metin> --what <metin> --rule <metin> [--task <id>]`, `lessons.js show [--since <tarih>]`): lider bir eskalasyon `to-lead` ya da `to-owner`'a ulaştığında, bir rol aynı hatayı tekrarladığında ya da siz lideri düzelttiğinizde bir ders kaydeder ve her aşamayı ders açısından gözden geçirir. Her ders `team/lessons.md` dosyasına (bu proje) ve `~/.claude/nac/lessons.md` dosyasına (bu makinedeki tüm projeler; dosya bu makinede kalır, hiçbir yere gönderilmez) yazılır. Aşama raporu yeni dersleri listeler; hangilerinin NAC kuralı olacağına siz karar verirsiniz, hiçbir şey kendiliğinden kural olmaz.

## Roller ve modeller

| Rol | Sorumluluk | Model |
|---|---|---|
| ekip lideri (oturumunuz) | Sizinle konuşur, iş dağıtır, panoyu tutar, size sorar | oturum modeliniz |
| researcher | Rakipler, teknoloji seçenekleri, bilinen saldırılar, lisanslar; kaynaklı | opus |
| finance-analyst | Maliyet tahmini, ücretli servisler, ücretsiz katman sınırları; kaynaklı | opus |
| research-reviewer | Faz 1 araştırmasının taze bağlamla incelenmesi: kaynak iddiayı destekliyor mu, öneriler brief'e uyuyor mu | opus |
| architect | Spec, servis ayrımı, veri modeli, sözleşmeler | opus |
| planner | Spec'i küçük, test edilebilir görevlere ve özetlere böler | sonnet |
| backend-developer | Sunucu kodu ve testleri | sonnet |
| frontend-developer | Arayüz kodu ve testleri | sonnet |
| database-engineer | Şema, migration, yetkiler, performans | sonnet |
| test-engineer | Uçtan uca, entegrasyon ve yük testleri, test vektörleri | sonnet |
| code-reviewer | Görev başına inceleme: spec uyumu ve kalite | sonnet |
| final-reviewer | Aşama sonunda bütün dalın incelemesi | opus |
| security-reviewer | Tehdit modeli, saldırı temelli inceleme | opus |
| doc-writer | Kararları belgelere yazar, proje belgelerini günceller | sonnet |
| assistant | Özetler, biçim kontrolleri, temizlik denemeleri | haiku |

İncelemecilere ve asistana dosya düzenleme aracı verilmez; okur, komut çalıştırır ve raporlar. Aynı anda en fazla 5 rol çalışır (ayarlanabilir).

## Sorular ve kararlar

Size gelen her soru aynı biçimdedir: **Kaynak** (nereden geldi, kim buldu), **Durum** (kod yazıldı mı, cevap mevcut işi değiştirir mi), **Etki**, seçenekler ve tek bir öneri. Her seferinde tek soru. `decisions.js ask`, 2'den az seçenekli ya da önerisi olmayan soruyu reddeder.

- Engelleyen bir soru hemen sorulur.
- Engellemeyen bir soru `team/decisions.md` içinde sıraya alınır ve ekip çalışmayı sürdürür. Sıradaki soruları istediğiniz an isteyin:

```
/nac:questions
```

Her cevap tarihiyle `team/decisions.md` dosyasına kaydedilir. Projenin nerede olduğunu görmek için:

```
/nac:status
```

## Eskalasyon

Bir tur, bir deneme ve onun incelemesidir. Lider turları pano kaydında sayar:

1. Çözülemeyen 2 turdan sonra rol bir üst model kademesinde yeniden dener (haiku, sonnet, opus).
2. 2 tur daha çözülmezse sorun lidere geçer; liderin 1 turu vardır.
3. Sonra size soru olarak gelir.

Her eskalasyon `team/work/escalations/` altına kaydedilir. Eşikler ayarlanabilir.

## Ortak bellek ve posta kutusu

- `team/work/board.md` görev panosudur: sahip rol, durum, turlar, model, commit'ler, devir notu. Yalnız lider yazar.
- `team/decisions.md` açık soruları ve kararları tutar. Yalnız lider yazar.
- `team/contracts/` arayüz sözleşmelerini tutar; sahibi olan rol yazar.
- Roller arasındaki her mesaj `team/work/mailbox/<thread>/` altında bir dosyadır. Bir hook her canlı mesajı oraya otomatik kopyalar; hiçbir şey bir ajanın hatırlamasına bağlı değildir. Roller gelen kutularını başlarken, her adımdan sonra ve bitirmeden önce kontrol eder.
- Yeniden başlatmadan sonra lider panodan, posta kutusundan ve devir notlarından durumu yeniden kurar.

## Temizlik

Sonucu `team/decisions.md` içinde olan ve 30 günden eski kapalı konuşmalar arşivlenebilir (varsayılan) ya da silinebilir. Kayıtlı bir sonuç olmadan hiçbir şey silinmez. Önce deneme çıktısı gösterilir, uygulamadan önce sorulur:

```
/nac:cleanup
```

## Yapılandırma

Ayarlar üç katmanda çözülür, sonraki kazanır: eklenti varsayılanları (`defaults/config.json`), kullanıcı ayarınız (`~/.claude/nac/config.json`), projenin `team/config.json` dosyası. Örnek proje ayarı:

```json
{
  "models": { "backend-developer": "opus" },
  "escalation": { "modelRounds": 3 },
  "maxActiveRoles": 3,
  "documents": { "articleDev": false },
  "cleanup": { "closedThreadMaxAgeDays": 14, "mode": "delete" }
}
```

`testCommand` (örneğin `"cargo test"`) projenin tüm testlerini proje kökünden çalıştıran komuttur. Test kapısı bu komutu her görevde shell'de çalıştırır. Planlayıcı önerir, siz faz 4 raporunda onaylarsınız, lider yazar.

## Ekip modu ve alt ajan modu, sınırlar

- **Ekip modu** (tasarım ve son kontrol): roller birbirine doğrudan soru soran adlı ekip üyeleridir.
- **Alt ajan modu** (planlama ve geliştirme): her görev için yeni, tek seferlik bir uygulayıcı ve incelemeci. Lider bunları adsız başlatır; böylece agent teams açıkken de alt ajan olarak kalırlar.

Bilmeniz gereken sınırlar:

- Karar vermeden önce size sorma kuralı mekanik bir engelle değil, talimatlarla uygulanır. Ekip üyeleri plan modunu kullanmaz.
- Ekip üyeleri `/resume` ile geri gelmez. Lider panodan, posta kutusundan ve devir notlarından durumu kurar ve gereken rolleri yeniden başlatır.
- Bir ekip üyesinin modeli başlatıldığında sabitlenir; yükseltmek rolü yeniden başlatmak demektir.
- Liderin modeli oturum modelinizdir. `/model opus` kullanın.
- `TaskCompleted` hook'u (bir ekip görevi ancak panoda bitti görünüyorsa kapanır) yalnız Claude Code yerel ekip görev araçları sunduğunda çalışır. Claude Code 2.1.302 ile yapılan canlı testlerde hiçbir oturumda bu görev araçları yoktu, bu yüzden hook hiç tetiklenmedi; erken "bitti"yi panodaki lider incelemesi durdurur.
- Agent teams, Claude Code'un deneysel bir özelliğidir (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`).

## Koşullu sıkıştırma

Lider bağlamı Claude Code tarafından kendiliğinden sıkıştırılır; bu bir görevin ortasında olabilir. NAC, otomatik sıkıştırmanın yalnız temiz bir noktada çalışmasına izin verir (yalnız lider oturumunda çalışan `PreCompact` kancası): devam eden görev yok, git çalışma ağacı temiz, son biten görevin commit'i var, açık/ertelenmiş sahip sorusu yok. Aksi halde tek satır gerekçeyle ertelenir; bağlam `compaction.ceiling` (varsayılan 300000 token) eşiğini aşarsa yine de çalışır. Elle `/compact` asla engellenmez, kanca hatası sıkıştırmaya izin verir. Çalıştığında `team/work/handoffs/compact-<damga>.md` devir notu yazılır ve sonraki oturum başı lideri ona yönlendirir. `/nac:setup` proje `.claude/settings.json` dosyasına `autoCompactWindow` (varsayılan 200000) ve `idleCompaction: false` yazar; daha önce kurulmuş projede `! node <yol>/scripts/setup.js --compaction` yalnız bunları yazar. Varsayılanlar:

```json
{ "compaction": { "autoCompactWindow": 200000, "ceiling": 300000 } }
```

Ayrıntılar İngilizce README'de.

## Güvenlik kuralları

- Push, merge, deploy, yayın, gönderi, altyapı uygulama ya da satın alma; o işlem için ayrı ve açık onayınız olmadan yapılmaz.
- Kurulum ve temizlik her zaman önce deneme çıktısı gösterir ve var olan dosyaların üzerine yazmaz.
- Roller yalnız kendi sorumluluk alanında çalışır; incelemecilere dosya düzenleme aracı verilmez.
- Araştırma rolleri (researcher, finance-analyst) güvenilmeyen web sayfaları ve rakip kodu okur; prompt injection'a karşı bir `PreToolUse` kancası onları sınırlar: yalnız `team/brief.md`, `team/research/` ve klon klasörünü, bir de kendi büyük araç çıktılarının kaydedildiği dosyayı okur (kararları, posta kutusunu, diğer rollerin notlarını ve liderin araç çıktılarını okuyamaz), yalnız `team/research/` altına yazar (devir notları dahil), Bash'te yalnız NAC'ın mailbox ve clone betiklerini çalıştırır. Kanca hata verirse çağrıyı engeller. Mesajı yalnız kendi başlıklarıyla gönderebilirler. Posta kutusu kancası her NAC rolünü, mesaj başlığı ne derse desin gerçek rolüyle kaydeder ve sahte bir gönderen iddiasını lidere bildirir; diğer roller araştırma mesajlarını veri olarak okur. Web araçları açıktır; okunacak gizli veri olmadığı için sızdıracak bir şey de kalmaz. Görünür enjekte metni hiçbir temizleme silemez; bu yüzden araştırma raporu sonraki rollerde veri olarak okunur.
- Bash ve PowerShell üzerindeki bir `PreToolUse` bekçisi her rolü ve lideri tek kurala bağlar: özyinelemeli silme (`rm -r`, `Remove-Item -Recurse`, `rmdir /s`, `rd /s`, `del /s`, `rimraf`, `find -delete`) yalnız proje içinde ve geçici klasörde serbesttir. Aynı komutta daha önce düz bir değerle atanmış değişken (`S=/tmp/x; rm -rf "$S"`, PowerShell için `$d = "..."`) önce o değerle değiştirilir; diğer değişkenler çözülmemiş sayılır. Sürücü kökü, `~`, `/`, ev dizini, proje dışındaki bir yol ya da çözemediği bir hedef (değişken, komut yerine koyma, `..` ile eşleşebilen bir desen) ajana lidere sormasını söyleyen bir iletiyle engellenir. Ayrıca `-x`/`-X` ile `-f`/`-d` içeren `git clean` komutunu (dry run serbest), engellenen bir yolu silen satır içi kodu (`node -e`, `python -c`, `perl -e`, `ruby -e`, `pwsh -Command`) ve `-EncodedCommand` komutunu (çözülüp denetlenir, çözülemezse engellenir) da engeller. Proje ya da geçici klasör içindeki, adıyla çalıştırılan bir betik dosyası (`bash x.sh`, `node x.js`, `python x.py`, `pwsh x.ps1`, `./x.sh`) 64 KiB altındaysa aynı kurallarla taranır; eklenti betikleri, eksik ve daha büyük dosyalar taranmaz.
- Hook'lar bir NAC projesi dışında (`team/config.json` olmayan klasörde) hiçbir şey yapmaz.

## SSS

### NAC diğer projelerimi yavaşlatır mı?

Hayır. Açtığınız projeler dışında kapalıdır.

### Bir rolle doğrudan konuşabilir miyim?

Evet. Olağan muhatabınız liderdir, ama herhangi bir ekip üyesine mesaj gönderebilirsiniz.

### Bir görevin ortasında Claude Code'u kapatırsam ne olur?

Sonraki oturum bir devam özetiyle başlar: aşama, süren iş (`git status` ile), açık pano kayıtları, lider için okunmamış mesajlar ve sıradaki sorular.

### Ekip durumu commit'lenir mi?

`team/brief.md`, `decisions.md`, `contracts/`, `research/`, `glossary.md` ve `config.json` commit'lenmek içindir. `team/work/` (pano, görev özetleri, devir notları, eskalasyonlar, posta kutusu) de commit'lenir; yalnız `team/work/packs/` (üretilen bağlam paketleri) git dışındadır. Lider bunu kendi commit'lerinde, `chore(team): <ne>`, her görev bittiğinde ve her lider rotasyonunda, açık yolları ekleyerek commit'ler; kod commit'lerine karıştırmaz. Kurulum eski `.gitignore` satırını `team/work/` yerine `team/work/packs/` yapar ve önce farkı gösterir.

## Lisans

MIT. Bazı bölümler Jesse Vincent'ın superpowers projesinden uyarlanmıştır; bkz. [NOTICE](NOTICE).

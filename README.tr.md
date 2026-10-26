# Nereus Agent Company (NAC)

[English](README.md)

Tek bir kişiye, yapay zekâ ajanlarından oluşan bütün bir yazılım ekibi veren bir Claude Code eklentisi. Ne istediğinizi anlatırsınız; kendi Claude Code oturumunuzdaki ekip lideri işi böler, rolleri çalıştırır ve karar size ait olduğunda size sorar.

## NAC nedir, neden var

Bir ürünü tek başına geliştirmek her rolü üstlenmek demektir: mimar, geliştirici, gözden geçiren, güvenlik incelemecisi, yazar. NAC bu rollerin her birine kendi talimatları ve modeli olan ayrı bir ajan verir ve sizinle onların arasına bir lider koyar. Arkasındaki ilkeler [manifestoda](MANIFESTO.tr.md).

- Yalnız liderle (Claude Code oturumunuzla) konuşursunuz. Görev atamazsınız.
- Ekip sizin yerinize karar vermez. Ürün, kapsam ve tasarım seçimleri, dışa dönük işlemler (push, deploy, yayın) ve onaylı plandan sapmalar her zaman size soru olarak gelir.
- Ekibin bildiği her şey projenizde `team/` altında durur; iş yeniden başlatmalardan sonra da devam eder.

NAC'ın görsel bir arayüzü yoktur. Claude Code terminalinin içinde çalışır.

**v1.3 kapsamı.** Bu sürüm çekirdek rolleri (ekip lideri, araştırmacı, finans analisti, mimar, planlayıcı, backend geliştirici, frontend geliştirici, veritabanı mühendisi, test mühendisi, kod incelemecisi, son incelemeci, güvenlik incelemecisi, doküman yazarı, asistan) ve 0, 1, 3, 4, 5 ve 6. aşamaları içerir. Sonraki adımlar: v2 ürün yöneticisi, UX ve UI tasarımcıları, DevOps mühendisi ile 2 ve 7. aşamaları; v3 pazarlama ve kalan iş rolleri ile 8 ve 9. aşamaları ekler.

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
- **Paralel görevler** (`worktree.js`): ikinci bir görev kendi git worktree'sinde (`<repo>-wt/<id>`, dal `task/<id>`; `team/config.json` içindeki `worktreeRoot` bunları başka bir dizine, örneğin geniş bir sürücüye taşır) başlar. Aynı ağaçta başka bir kod görevi sürerken `board.js update <id> --status in-progress` reddedilir (g24); worktree `--worktree <yol>` ile kaydedilir; `integrate` onu çalışma dalına yerelde cherry-pick ile alır. Push, ana dala birleştirme ve yayına alma yine sizin onayınızı ister.
- **Lider rotasyonu** (`board.js`): 5 görev bittikten sonra (ya da bir kilometre taşı sonunda) lider bir devir notu yazar ve sizden `/clear` çalıştırmanızı ister; sonraki oturum buradan devam eder.
- **Atlanan test sayısı** (`gate.js`): test kapısı kaç testin atlandığını, yok sayıldığını ya da todo olduğunu bildirir; her atlama için devir notunda yazılı bir gerekçe gerekir.
- **Tur bütçesi** (`turnBudget`, 1.3.34'ten beri varsayılan 50; eski adı `callBudget` hâlâ çalışır): her görevlendirme 50 model turu kullanabilir, paralel araç çağrıları tek tur sayılır (paket başlığında yazar; ajan dosyalarındaki `maxTurns` 55'tir, raporu yazmak için 5 tur payı kalır). Bütçeye ulaşan rol commit atmaz (bir hook bütçede `git commit` komutunu reddeder, g61), neyin bittiğini ve neyin kaldığını bildirir; lider kalanı yeni bir paketle (aynı tur) yeniden görevlendirir ya da görevi böler.
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

`gateCommands` (g18), sıralı bir `{ "name", "command" }` kontrol listesidir (örneğin test, `cargo clippy -- -D warnings`, `cargo fmt --check`). Kapı hepsini çalıştırır, her birini raporlar ve biri kırmızıysa başarısız olur; `testCommand` tek kontrol için takma ad olarak kalır. Bir `pack-guard` hook'u (g22), bağlam paketi göstermeyen geliştirici, database-engineer, gözden geçirici, güvenlik, test-engineer veya final-reviewer görevlendirmesini reddeder; kayıtlı kaçış yolu görevlendirme metnine `--no-pack <gerekçe>` yazmaktır. `/nac:setup`, yapılandırmada ikisi de yoksa algılanan Rust veya Node projesi için varsayılan listeyi doldurur.

Verimlilik kontrolleri, F bölümü (g19 sert): `board.js update --status done`, en çok bir kod commit'i olan M veya L bir görevde (boyutu olmayan görev M sayılır) reddedilir; `--single-commit <neden>` verilirse geçer (neden `team/decisions.md` dosyasına yazılır). S görevler ve `--code no` görevler denetlenmez. (g26) Lider mesajı `team/decisions.md` içinde olmayan bir Q-id ya da D-id anarsa Stop hook'u onu bir kez geri gönderir; sahip ve vekil soruları önce `decisions.js ask` ile kaydedilir, D-id'ler `decide` çıktısından alınır. (D-227) Takım durumu commit'leri yalnız `team/` yol belirtecini kullanır: `node scripts/team-commit.js --message <metin>` `git commit -- team/` çalıştırır; ortak indekste hazırlanmış geliştirici kodu hiçbir `chore(team)` commit'ine karışmaz. (g11) `setup --apply` oluşturduğu ya da değiştirdiği dosyaları, yalnız o dosyaların yol belirteciyle, tek bir `chore(nac)` commit'inde kaydeder; git dışında ya da zaten commit edilmemiş değişikliği olan bir dosyada dosyayı yazar ve uyarı verir. (g23) Brief satırı `Go-path test: <komut>` biçimindedir: `decisions.js ask --irreversible` bu komutu projede çalıştırır (10 dakika zaman aşımı) ve komut 0 ile çıkmaz ya da kapı yeşil değilse reddeder; yalnız dosya adı reddedilir.
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

Lider bağlamı Claude Code tarafından kendiliğinden sıkıştırılır; bu bir görevin ortasında olabilir. NAC, otomatik sıkıştırmanın yalnız temiz bir noktada çalışmasına izin verir (yalnız lider oturumunda çalışan `PreCompact` kancası): liderin kendi durumu güvenli olmalı (g25): `team/` commit'li (yalnız `team/` altı sayılır), son biten görevin commit'i var, bu turda yanıt bekleyen sahip sorusu yok (park edilmiş, ertelenmiş, kuyruktaki sorular engellemez), her `in-progress` görevin devir dosyası var. Süren görevler tek başına engellemez; devir notu her birini rolü, ajanı, worktree'si ve devir dosyasıyla listeler. Aksi halde tek satır gerekçeyle ertelenir; bağlam `compaction.ceiling` (varsayılan 220000 token) eşiğini aşarsa yine de çalışır. Elle `/compact` asla engellenmez, kanca hatası sıkıştırmaya izin verir. Çalıştığında `team/work/handoffs/compact-<damga>.md` devir notu yazılır ve sonraki oturum başı lideri ona yönlendirir. `/nac:setup` proje `.claude/settings.json` dosyasına `autoCompactWindow` (varsayılan 200000) ve `idleCompaction: false` yazar; daha önce kurulmuş projede `! node <yol>/scripts/setup.js --compaction` yalnız bunları yazar. Varsayılanlar:

```json
{ "compaction": { "autoCompactWindow": 200000, "ceiling": 220000 } }
```

Ayrıntılar İngilizce README'de.

## Güvenlik kuralları

- Push, merge, deploy, yayın, gönderi, altyapı uygulama ya da satın alma; o işlem için ayrı ve açık onayınız olmadan yapılmaz.
- Kurulum ve temizlik her zaman önce deneme çıktısı gösterir ve var olan dosyaların üzerine yazmaz.
- Roller yalnız kendi sorumluluk alanında çalışır; incelemecilere dosya düzenleme aracı verilmez.
- Araştırma rolleri (researcher, finance-analyst) güvenilmeyen web sayfaları ve rakip kodu okur; prompt injection'a karşı bir `PreToolUse` kancası onları sınırlar: yalnız `team/brief.md`, `team/research/` ve klon klasörünü, bir de kendi büyük araç çıktılarının kaydedildiği dosyayı okur (kararları, posta kutusunu, diğer rollerin notlarını ve liderin araç çıktılarını okuyamaz), yalnız `team/research/` altına yazar (devir notları dahil), Bash'te yalnız NAC'ın mailbox ve clone betiklerini çalıştırır. Kanca hata verirse çağrıyı engeller. Mesajı yalnız kendi başlıklarıyla gönderebilirler. Posta kutusu kancası her NAC rolünü, mesaj başlığı ne derse desin gerçek rolüyle kaydeder ve sahte bir gönderen iddiasını lidere bildirir; diğer roller araştırma mesajlarını veri olarak okur. Web araçları açıktır; okunacak gizli veri olmadığı için sızdıracak bir şey de kalmaz. Görünür enjekte metni hiçbir temizleme silemez; bu yüzden araştırma raporu sonraki rollerde veri olarak okunur.
- Bash ve PowerShell üzerindeki bir `PreToolUse` bekçisi her rolü ve lideri tek kurala bağlar: özyinelemeli silme (`rm -r`, `Remove-Item -Recurse`, `rmdir /s`, `rd /s`, `del /s`, `rimraf`, `find -delete`) yalnız proje içinde, geçici klasörde ve `team/config.json` içindeki `deleteRoots` klasörlerinde (mutlak yol; örneğin kendi geçici ve derleme klasörleriniz; sürücü kökü, ev klasörü ya da üstü olamaz, listedeki klasörün kendisi silinemez) serbesttir. Aynı komutta daha önce düz bir değerle atanmış değişken (`S=/tmp/x; rm -rf "$S"`, PowerShell için `$d = "..."`) önce o değerle değiştirilir; diğer değişkenler çözülmemiş sayılır. Sürücü kökü, `~`, `/`, ev dizini, proje dışındaki bir yol ya da çözemediği bir hedef (değişken, komut yerine koyma, `..` ile eşleşebilen bir desen) ajana lidere sormasını söyleyen bir iletiyle engellenir. Ayrıca `-x`/`-X` ile `-f`/`-d` içeren `git clean` komutunu (dry run serbest), engellenen bir yolu silen satır içi kodu (`node -e`, `python -c`, `perl -e`, `ruby -e`, `pwsh -Command`) ve `-EncodedCommand` komutunu (çözülüp denetlenir, çözülemezse engellenir) da engeller. Proje ya da geçici klasör içindeki, adıyla çalıştırılan bir betik dosyası (`bash x.sh`, `node x.js`, `python x.py`, `pwsh x.ps1`, `./x.sh`) 64 KiB altındaysa aynı kurallarla taranır; eklenti betikleri, eksik ve daha büyük dosyalar taranmaz.
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

## 1.3.52 değişiklikleri

- **Test geçici artıkları silinir** (g94): her test koşusu kendi geçici klasörünü bırakır ve bunları silen bir şey yoktu. Memory Agent'ta iki günde yaklaşık 14.000 `fakeclaude-*` (8 GB) ve 48.000 `nim-*` (17 GB) klasörü birikti. Bunları `testTempDirs` listesine (team/config.json) `"<mutlak klasör>/<önek>*"` olarak yazın. Önek en az 3 karakter olmalı; klasör sürücü kökü, ev klasörü ya da onun üstü olamaz. `task.js close` 6 saatten eski olanları siler, böylece paralel bir görevin taze koşusu kendi klasörünü korur, ve `testTempRemoved` bildirir. `worktree.js prune --shared` hiçbir derleme çalışmazken hepsini siler.

## 1.3.51 değişiklikleri

- **Kapanış görevin açık ajanlarını hatırlatır** (g93): Memory Agent'ta T-108a'nın ilk tur geliştiricisi, görev kapandıktan sonra iki saat açık kaldı. NAC liderin ajanlarını göremediği için `task.js close` artık `agentsNote` döndürüyor. Bu not, göreve ait açık kalan her ajanın TaskStop ile ajan kimliğinden durdurulmasını söylüyor; süreç adıyla durdurma yok. task-loop referansı da aynısını söylüyor.

## 1.3.50 değişiklikleri

- **Ortak derleme klasörleri için bakım rutini** (g91): biten görev temizliği (g90), her gate'in derlediği ortak target klasörlerine dokunmaz (Memory Agent: `build/debug` ~90 GB, ana ağacın `target`'ı ~53 GB) ve bunlar D:'yi yine doldurdu. Bunları `sharedBuildDirs` listesine yazın (team/config.json; her biri projenin ya da bir `deleteRoots` klasörünün içinde olmalı). Diskte `maintenanceFreeGB` değerinden (varsayılan 20, 0 = kapalı) az yer kalınca `task.js start` reddeder, `task.js close` ve gate `maintenance` bildirir. Lider yeni iş başlatmaz, çalışanların bitmesini bekler. Sonra `worktree.js prune --shared` bu klasörleri ve biten görevlerin derleme çıktısını siler; cargo ya da rustc çalışırken `busy` döner ve hiçbir şey silmez. Gate'in kendi alt sınırı `gateMinFreeGB` varsayılanı 10'a iner, böylece kuyruk boşalırken çalışan görevlerin gate'leri yine koşar.

## 1.3.49 değişiklikleri

- **Klasör adında görev kimliği eşleşmesi sıkı** (g90): Memory Agent'taki ilk `worktree.js prune`, `d018-` gibi bir uuid parçasını T-018 sandı. Yalnız geçici klasörler silindi, ama bir derleme klasörü de aynı yolla yanlış eşleşebilirdi. Kimlik artık yalnız çıplak ya da `t`/`t-` önekiyle eşleşiyor (`review-t047`, `047`, `t-047`).

## 1.3.48 değişiklikleri

- **Biten görevin derleme çıktısı kendiliğinden silinir; dolu disk tur sayılmaz** (g90): Memory Agent'ta review ve base denetimleri, projenin build klasörüne yalnızca görev kimliğini taşıyan adlarla derlendi (`review-t047`, `review-t047-base`, `t105a`, `review-061b`, yaklaşık 33 GB). Bunları silen bir şey yoktu. Beş görev aynı anda derlerken D: doldu ve gate "yer kalmadı" hatalarını 9 kırmızı test olarak raporladı. Artık `task.js close` kapanan görevin derleme klasörlerini siliyor: worktree'nin yanındaki `target-<id>`/`tmp-<id>` ile `deleteRoots` klasörlerinde adında görev kimliği ayrı bir parça olarak geçen klasörler. Açık bir görevi de adlandıran ve `debug` gibi ortak klasörler kalır. `worktree.js prune [<id>]` aynısını bütün biten görevler için yapar. Gate, denetimlerden önce görevin diskindeki boş alanı ölçer. Boş alan `gateMinFreeGB` değerinin (varsayılan 20, 0 = denetim yok) altındaysa önce temizler. Hâlâ altındaysa çalışmaz ve `disk` + `diskNote` döner (tur sayılmaz). Çıktısı diskin dolduğunu söyleyen bir kırmızı `diskFull` taşır.

## 1.3.47 değişiklikleri

- **Süreç adıyla öldürme yok** (g88): Memory Agent'ta bir geliştirici, dört görev kendi worktree'lerinde derleyip gate koşarken `pkill -f cargo` çalıştırdı; onu yalnız Claude Code'un otomatik mod sınıflandırıcısı durdurdu. Yıkıcı komut koruması artık `pkill`, `killall`, `taskkill /IM` ya da `/FI`, `Stop-Process -Name` ve `Get-Process x | Stop-Process` komutlarını engelliyor. PID ile durdurma (`kill <pid>`, `Stop-Process -Id`, `taskkill /PID`) serbest.
- **Görevin worktree'si proje dışı değil** (g89): aynı geliştiricinin kendi worktree'sindeki (`worktreeRoot` altında) `rm -rf target` komutu proje dışı diye engellendi. Worktree klasörü (`<proje>-wt`, `worktreeRoot` varsa onun altında) artık `deleteRoots` gibi sayılıyor; klasörün kendisi ve yanındakiler yine engelli.

## 1.3.46 değişiklikleri

- **Vadesi gelen sertleştirme her kapanışta anılıyor** (g87): `hardeningDue` yalnız `findingsBatch` eşiğini aşan bulgu eklenirken bir kez görünüyordu ve kolayca kayboluyordu. Memory Agent lideri kullanıcıya tüm geliştirmenin bittiğini söyledi; oysa memory modülünde 14 sayılan sertleştirme bulgusu vardı ve fazda memory sertleştirme görevi yoktu (core 24, mcp 19, cli 10 da eşiğin üstündeydi). `task.js close` artık sayılan bulgusu eşiğe ulaşan ve açık sertleştirme görevi olmayan her modülü uyarı olarak yazıyor; sıkıştırma devir notundaki sıradaki görev satırı da bunları tahtadaki diğer işlerden önce gösteriyor.

## 1.3.45 değişiklikleri

- **Bağlam paketi görevin kendi kararlarını getiriyor** (g86): paket yalnız brief'in andığı kararları alıyordu. Kullanıcı T-087c S6'yı günler önce karara bağlamıştı (D-263, başlığında "(T-087c S6)"), brief bunu anmadı, geliştirici diğer seçeneği yaptı ve görev düzeltme turuna döndü. Başlığında görev numarası tam kelime olarak geçen karar artık brief anmasa da pakete bir kez giriyor; üst görev numarası (T-087) alt görevin (T-087c) kararlarını almıyor.

## 1.3.44 değişiklikleri

- **PowerShell here-string'i silmeyi dengesiz tırnak diye engellemiyor** (g85): silme koruması here-string'in açılış `@'` işaretini satırda tek başına bir tırnak olarak bırakıyordu; here-string ve silme kelimesi içeren her PowerShell komutu engelleniyordu (Memory Agent T-078 kapanışı: bulgu JSON'u `$j = @'...'@` içinde, ardından geçici dosyanın `Remove-Item` ile silinmesi). Açılış artık boş bir dize sayılıyor; kapanış `'@` satırında ardından gelen komut yine denetleniyor.

## 1.3.43 değişiklikleri

- **Silme koruması gateTmp içindeki silmeye izin veriyor** (g84): gate'in geçici klasöründeki test artıklarını silen bir rol (Memory Agent T-106: `rm -rf D:/nac-tmp/t032b-fi-docs-*`) proje ve geçici klasör dışında sayılıp engellendi. `team/config.json` içindeki `gateTmp` artık bir `deleteRoots` klasörü gibi sayılıyor: içindeki silmeler serbest, klasörün kendisi ve yanındakiler değil. Sürücü kökü ya da ev klasörü olan bir `gateTmp` hiçbir şey eklemiyor.

## 1.3.42 değişiklikleri

- **Bir tutamacı bırakmak sürüm yayını değildir** (g83): index.db ve kilidini bırakmayla ilgili bir soru ("üretim yolu testlerin kanıtladığı aynı release kodunu çalıştırır") kullanıcıya ait yayın sayılıp reddedildi ve lider kullanıcıya kutu açtı. Tutamaç, kilit, dosya, bellek ya da bağlantı bırakmak ve "release code/path/logic" artık kullanıcıya ait yayın sayılmıyor; "release v1.0" ve "release the code to users" hâlâ sayılıyor.

## 1.3.41 değişiklikleri

- **NAC'in kendi testleri geçici klasörlerini temizliyor** (g82): test takımı her test için bir geçici klasör açıp hiç silmiyordu (oturum geçici klasöründe ~34.000 klasör, 26 GB). `npm test` artık `tests/tmp-root.cjs` dosyasını önceden yüklüyor: bir test sürecinin `mkdtemp` ile açtığı her klasör kaydediliyor ve koşu bitince test çalıştırıcısı bunları, yanlarındaki `<klasör>-wt*` worktree'leriyle birlikte siliyor. `TMP` yerinde kalıyor: onu bir alt klasöre taşımak ya da başka test dosyaları çalışırken klasör silmek, git'in "Permission denied" ile daha sık düşmesine yol açtı. Takımı `npm test` ile çalıştırın; yalın `node --test` önceden yüklemeyi atlar.

## 1.3.40 değişiklikleri

- **Gate testlerin geçici klasörlerini temizliyor** (g81): projenin testleri her çalıştırmada `nim-*` klasörlerini bırakıyordu (Memory Agent: gateTmp'te ~10 GB, C:'de 38 bin klasör). `gateTmp` ayarlıysa her gate çalıştırması içinde kendi `gate-<pid>-<zaman>` klasörünü alıyor ve bittiğinde, yeşil ya da kırmızı, onu siliyor; paralel çalıştırmalar birbirinin dosyasını silmiyor. Worktree silinince görevin yanındaki `tmp-<id>` klasörleri de siliniyor.

## 1.3.39 değişiklikleri

- **Paket, projenin kurallarının reddettiği yolu söylüyor** (g79): Memory Agent T-101 ve T-102 brief'leri role bir modülü `#[path]` ile almasını söyledi; projenin unsafe_policy R1 kuralı bunu reddediyor ve T-101 1. turunu buna kaybetti. `team/config.json` içindeki `briefForbid` (`{ text, rule }` listesi) ilk paket kurulurken brief'e karşı denetlenir; eşleşme `briefForbidden` olarak ve gönderimden önce brief'i düzeltme notuyla döner.
- **`/clear` rotasyonu hafızaya bırakılmıyor** (g80): `rotateBy: "clear"` ile lider iki kez sahibe `/clear` sormadan sonraki göreve geçti. Kapanış artık `.git` içine bir işaret bırakıyor; sonraki `task.js start` bir kez reddedip sahibe gönderilecek satırı veriyor. `/clear` ya da yeni oturum işareti siler; "devam" `/clear` olmadan geldiyse `--same-session` aynı oturumda sürdürür.

## 1.3.38 değişiklikleri

- **Cargo'nun `publish = false` ayarı yayın sayılmıyor** (g78): Memory Agent Q-194 "publish=false path crate" önerdi; sahibe ait eylem kontrolü "publish" kelimesini eşleştirip vekil cevabını reddetti ve T-102 sahibi bekledi. `publish = false` (ve `publish = []`) bir crate'in hiç yayınlanmamasını sağlar, artık sahibin eylemi sayılmıyor.

## 1.3.37 değişiklikleri

- **`gateTmp` gate'in geçici dosyalarını sistem diskinden uzak tutuyor** (g77): Memory Agent T-101'de lider gate'i PowerShell aracından koştu; bu aracın TMP değeri Windows kullanıcı değeri (C:Users...Temp) olduğu için testler geçici dosyalarını dolu C: diskine yazdı. `team/config.json` içindeki `gateTmp` (bir klasör, yoksa oluşturulur) her gate kontrolü için TMP, TEMP ve TMPDIR değerini ayarlar.

## 1.3.36 değişiklikleri

- **Lider rotasyonunun yolunu `rotateBy` seçiyor** (g76): Memory Agent'ta lider her sıkıştırmadan sonra çağrı başına ~62k ile devam etti (özet ve yeniden yüklenen dosyalar; yeni oturum ~37k) ve bir günde 8 kez, bazen 3-4 dakika arayla sıkıştırdı. `team/config.json` içindeki `rotateBy` (`clear` ya da `compaction`) artık `.claude/settings.json`'dan okunan yolu eziyor ve rotasyonu her görevden sonraya alıyor (`rotateEvery` yine ezer). `clear` ile lider sahipten (ve sahip vekilinden) `/clear` ve "devam" ister; "devam" `/clear` olmadan gelirse aynı oturumda devam eder.

## 1.3.35 değişiklikleri

- **L görevi adım adım gönderiliyor** (g75): Memory Agent T-099, T-100 ve T-074'te görevin tamamı tek gönderimde verildi; geliştirici bir adımın ortasında tur bütçesine ulaştı, yarım iş commit'lenmeden kaldı ve sonraki gönderim nerede kaldığını bulmaya tur harcadı. task-loop skill'i artık L görevinde baştan her gönderime bir adım (bir commit) planlanmasını söylüyor; her gönderim yeşil bir commit'le biter, sonraki paket onun farkını taşır. M görevi, brief'inde 3'ten fazla adım yoksa tek gönderim kalır.

## 1.3.34 değişiklikleri

- **Tur bütçesi 50** (g74): üst üste üç orta boy görevde (Memory Agent T-099, T-100, T-074) geliştirici 40 turun hepsini kullandı ve üç commit'ten biri bitmişken durdu; her yeniden görevlendirme yeni bir paket ve bağlamı baştan kurdu. Sahip ilk adım olarak `turnBudget`'ı 50 yaptı; ajan dosyalarındaki `maxTurns` artık 55, rapor için 5 tur payı korunuyor. Bir proje kendi `turnBudget` değerini `team/config.json` içinde yine verebilir.

## 1.3.33 değişiklikleri

- **Yıkıcı komut koruması `node -e '...'` düzenlemelerini doğru okuyor** (g72): bir geliştirici bir Rust testini `node -e '...'` ile düzenledi; koruma tek tırnak içindeki JS şablon dizgilerini `` `...` `` komut yerine koyma, `rest.find(` çağrısını da `find` komutu sandı ve düzenlemeyi dengesiz tırnak diye engelledi. Geliştirici komutu bir kez aynen yeniden denedi, sonra dört Edit çağrısıyla yeniden yaptı. Bash'te tek tırnaklı metinde artık komut yerine koyma yok; bir metod çağrısı (`.find(`, `.remove`) silme komutu sayılmıyor. `` `...` ``, `$( )` içindeki ve tırnaklı bir sözcükten sonraki gerçek silmeler hâlâ denetleniyor.

## 1.3.32 değişiklikleri

- **Lider gate'i ön planda koşuyor** (g71): lider `gate.js`'i arka plan kabuğunda koştu; oturum beklerken Claude Code bellek baskısı yüzünden onu durdurdu, gate sonucu kayboldu ve lider yeniden koşmak için onay istemek zorunda kaldı. task-loop skill'i artık gate'in ön planda, araç zaman aşımı en yüksek değerde (600000 ms) koşmasını söylüyor; rollerde bu kural zaten vardı (g31).

## 1.3.31 değişiklikleri

- **task-loop skill'i sıkıştırma sonrası yeniden yüklemeye sığıyor** (g67): Claude Code her sıkıştırmadan sonra skill'i 20000 karakterde keserek geri koyuyor; skill 27085 karakterdi, bu yüzden Automation first, Role rule, Turn budget, Review round cap, Lessons ve Never oturumun kalanında kayboluyordu. `SKILL.md` artık her kuralı kısa haliyle tutuyor (yaklaşık 13700 karakter; Never, tur sınırı ve tur bütçesi başta), `skills/task-loop/reference.md` tam metni, gerekçeleri ve seyrek yolları saklıyor. Hiçbir kural silinmedi.
- **`task.js note` ve `decisions.js decide` `--chore` alıyor** (g67): çoğunun ardından ayrı bir git commit çağrısı geliyordu; her biri tüm bağlamı yeniden okuyan bir lider turu daha. `--chore` ile aynı çağrı `team/` klasörünü `chore(team)` olarak commit'liyor.
- **Koşul olarak geçen push soruyu artık sahibe göndermiyor** (g70): vekil kontrolü "(CI runs only after an owner push)" ve "drop the 3 file-symlink tests" yüzünden bir cevabı reddetti. Edattan sonra gelen push ("after an owner push", "before any v* tag push"), CI tetikleyicisi olarak push ("push guard", "on push events") ve sonraki ismi niteleyen `file-` artık sahibin eylemi sayılmıyor; "push the branch", "merge after the owner push" ve "drop the 3 files" hâlâ sayılıyor.

## 1.3.30 değişiklikleri

- **Kırmızı test kontrolünün tekrarı yalnız düşen testleri, birer birer koşuyor** (g69): kırmızı kontrol aynı paralel yük altında baştan koşuyordu (g64), bu yüzden bir zamanlama testi iki kez kırmızı çıktı: ilk koşuda bir süre testi, tekrarda başka biri düştü ve görev tek başına geçen bir kırmızı için geliştirici çağırdı. Düşen testlerini adlandıran kırmızı bir `cargo test` kontrolü artık yalnız onları `--exact --test-threads=1` ile tekrar koşuyor; yeşil çıkarsa `flaky` (kayıt hangi testlerin tek başına koştuğunu söylüyor) ve round değil. Tekrar yalnız bu testlerin her biri koşup geçtiyse yeşil sayılıyor (`notRun`, süzgecin kaçırdığı testi adlandırıyor). Diğer komutlar, derleme hatası ya da takılma eskisi gibi baştan koşuyor.

## 1.3.29 değişiklikleri

- **İsim olarak geçen sahip-yalnız kelime soruyu artık sahibe göndermiyor** (g68): vekil kontrolü, bir sağlamlaştırma görevi ekleme sorusundaki "release work goes on" içinde "release" kelimesini eşleştirdi, vekil cevabını reddetti; lider beklerken bir planlama sorusunu sahip cevaplamak zorunda kaldı. İşi, bir fazı ya da zamanı adlandıran release, publish ve deploy ("release tasks", "a release blocker", "before release", "the pre-release checklist", "yayın görevleri", "yayından önce") artık sahibin eylemi sayılmıyor; "merge PR #12 into main", "publish v1.0", "push the branch" ve sahibin verisini silmek hâlâ sayılıyor.

## 1.3.28 değişiklikleri

- **Kapsamlı kapı tüm paketleri okuyan kontrolleri de koşuyor, görevden önce gelen kırmızı round değil** (g66): bir görev cli testine `cfg(windows)` olmadan yalnız Windows'ta derlenen bir çağrı ekledi. Kapısı cli ve ona bağımlı paketlerle sınırlıydı (g55); her paketi Linux için derleyen test (cli'ye bağımlı olmayan core'da) hiç koşmadı ve kırmızı tabana geçti. Sonraki görevin kapısı onu buldu, round saydı ve bu round tek satırlık bir düzeltme için geliştiriciyi Opus'a yükseltti. `team/config.json` içindeki `gateAlwaysRun` (`{ name, command }` listesi) kapsamlı kapının kendi kontrollerinin yanında koştuğu kontrolleri tutuyor; `scope.alwaysRun` onları adlandırıyor, tam kapı onları zaten kapsadığı için eklemiyor. `board.js round <id> --reason base --finding <F-id>` görevin tabanında da kırmızı olan bir hatayı kaydediyor: görev onu aynı modelle kendi commit'inde düzeltiyor, round sayısı ve model değişmiyor, kayıt `basefixes` altında listeleniyor.

## 1.3.27 değişiklikleri

- **Kırmızı kapı düşen testlerin adını veriyor** (g65): `--no-fail-fast` ile (1.3.26) test çıktısı uzun ve sonu yalnızca kırmızı test dosyalarını söylüyordu ("2 targets failed: hygiene, unsafe_policy"); lider hangi testlerin düştüğünü göremedi, turun geliştiricisi önce onları bulmak zorunda kaldı. Kırmızı test kontrolü artık düşen testleri `checks[].failed` içinde, her birinin panic satırlarının başını `checks[].failures` içinde veriyor; sonuçta da her kırmızı kontrol için `check: test` biçiminde `failed` var.

## 1.3.26 değişiklikleri

- **Bilinen ortam kırmızıları ve yükten gelen kırmızı artık round yemiyor** (g64): `cargo test` ilk kırmızı test dosyasında duruyordu; bir projede bir test o makinede ortam nedeniyle (geçici klasörde geniş ACL, kayıtlı bulgu) kırmızıydı, bu yüzden ondan sonraki testler kapıda hiç koşmuyor ve lider kırmızıyı her seferinde elle geçiyordu. Başka bir görev, paralel derlemenin cargo paket kilidini tutmasından gelen bir kırmızıya round kaybetti; developer düzeltecek bir şey bulamadı, kapı tek başına yeşildi. Kapı artık `cargo test`'i `--no-fail-fast` ile koşuyor. `team/config.json` içindeki `gateKnownRed` bu makinede kırmızı olduğu bilinen testleri `test`, `finding` ve `reason` ile listeliyor; tek kırmızısı listede olan test kontrolü yeşil sayılıp `knownRed` içinde adlandırılıyor, derleme hatası asla bilinen kırmızı değil, listedeki bir test geçerse `knownRedPassed` içinde adlandırılıyor ki kaydı ve bulgusu kapansın. Kırmızı kontrol yeniden koşuyor (`gateRetry`, varsayılan 1, 0-3); önce kırmızı sonra yeşil `flaky` olarak raporlanıyor ve round değil.

## 1.3.25 değişiklikleri

- **Kullanım limitine takılan rol baştan başlatılmıyor, sürdürülüyor** (g63): kullanım limiti bir rolü çalışırken durdurduğunda lider onu yeni paketle yeniden dağıtıyordu; gerçek iş yapmış rol her şeyi yeniden okuyup tekrar yapıyordu. Claude Code duran alt ajanın kaydını saklıyor ve ajan kimliğine SendMessage onu bağlamıyla sürdürüyor. Yeni `agent-state.js <agentId>` rolün kaydını okuyup kaç tur kullandığını, limitin durdurup durdurmadığını ve ne yapılacağını söylüyor: en az 10 tur iş yapmış ve tur bütçesine yakın değilse `resume` (sıfırlanınca SendMessage), değilse `fresh` (yeni paket). Görev döngüsü yeniden dağıtmadan önce bunu çalıştırmayı ve limit durmasının asla round sayılmadığını söylüyor.

## 1.3.24 değişiklikleri

- **Tur bütçesinde commit yok** (g61): ikinci bütçe durmasında bir geliştirici, var olan 12 testin 7'si kırmızıyken fark etmeden commit attı; sonraki dağıtım önce kırmızının kendisinden mi geldiğini bulmak zorunda kaldı. Bütçeye ulaşan rolün tüm testleri koşacak turu kalmadığı için yeni bir `PreToolUse` hook'u (`budget-commit-guard.js`) `turnBudget` tur kullanmış NAC rolünün `git commit` komutunu reddediyor; lider ve NAC dışı ajanlar denetlenmiyor. Bütçe uyarısı artık değişiklikleri commit etmeden bırakmayı söylüyor; her paket görev ağacındaki commit edilmemiş değişen ve yeni dosyaları "Uncommitted work in the tree" altında listeliyor, böylece sonraki dağıtım `--base` olsun olmasın onlardan başlıyor.
- **Özyinelemeli silme için sahibin kendi geçici ve derleme klasörleri** (g62): silme bekçisi yalnız proje ve işletim sistemi geçici klasöründe izin veriyordu; geçici dosyalarını sahibin istediği yerde (`D:/Claude Sessions/<proje>/tmp`) tutan rol engellenip sormak zorunda kalıyordu. `team/config.json` içindeki `deleteRoots` başka klasörler (mutlak yol) listeliyor; bunlar geçici klasör gibi sayılıyor: içlerinde silme serbest, klasörün kendisi değil. Sürücü kökü, ev klasörü ya da onun üstü yapılandırma denetiminde reddediliyor; bekçi böyle bir giriş içeren listeyi yok sayıyor.

## 1.3.23 değişiklikleri

- **Tur bütçesi durması "takıldı" round'u olarak sayılamıyor** (g60): `board.js round --reason budget` reddediliyordu (g46); lider bunun yerine `--reason stuck` yazdı. Bir projede üç bütçe durması (geliştirici 40 turda, kod henüz derlenmiyor) round sayıldı; bu round sınırını harcıyor ve görevi erken yükseltebiliyor. `turn-budget` hook'u artık durmayı rol başına kaydediyor (`team/work/budget-stops.json`; rol worktree'deyse ana ağaçta). Kayıt durdukça o rolün görevi için `board.js round <id> --reason stuck` reddediliyor ve taze paketle yeniden dağıtımı söylüyor; o rol için `pack.js` kaydı siliyor. `--reason gate` ve `--reason review` değişmedi.

## 1.3.22 değişiklikleri

- **Kod görevi ancak kod incelemesi kaydedilince kapanıyor** (g59): `task.js close` yalnız `security: contract` görevinin security-reviewer onayını arıyordu; görev döngüsü de code-reviewer kararını kaydetmeyi söylemiyordu. Bir projede biten 84 kod görevinin 71'i board'da code-reviewer kararı olmadan kapandı; değişiklik isteyen bir inceleme de sessizce kapanabilirdi. Kod rolüne (backend-developer, frontend-developer, database-engineer, test-engineer) ait görev artık `board.js review <id> --role code-reviewer --verdict pass` sonrası kapanıyor; ret mesajı bu komutu ve son kararı söylüyor. `code: no` görevler, diğer rollerin görevleri ve `board.js update --status done` değişmedi.

## 1.3.21 değişiklikleri

- **Paket, görev tanımlarının gerçekte yazdığı spec atıflarını okuyor** (g57): `pack.js` spec bölümünü yalnız kalın numara (`**6.1**`), sözleşmeyi yalnız `ad 4` biçiminde tanıyordu. `Spec: 6.1, 6.6; storage-schema.md 4` yazan görev tanımları (bir projede 73'ün 68'i) spec bölümleri olmadan ve "Not found" listesinde tek satır olmadan gidiyordu; rol spec'i kendisi arıyordu. Artık `Spec:` sonrasındaki düz numaralar ve dosya adıyla yazılan sözleşmeler (`storage-schema.md 4`, `contracts/mcp-tools.md 3.5`) sayılıyor; hiçbir atıf çıkmayan bir Spec satırı "Not found" altında yazılıyor.
- **Silmeyle ilgili ürün sorusu artık sahip-yalnız değil** (g58): sahip-yalnız denetimi "sil" ile başlayan her kelimeyi ve yalın "delete" kelimesini yakalıyordu. Silinmiş notların bir sınıra sayılıp sayılmayacağını soran bir soru "sahibin verisini silme" diye reddedildi ve lider gece sahibi kutuda bekledi. Silme artık yalnız neyin silindiği yazıyorsa sahip-yalnız (veri, dosya, dal, depo, veritabanı, yedek, geçmiş; Türkçede "sil"den önce gelen isim) ve ret mesajı hangi kelimelerin eşleştiğini söylüyor.

## 1.3.20 değişiklikleri

- **Reddedilen görev numarası yanlış görevi başlatamaz** (g56): lider yeni bir sertleştirme görevine kullanılmış bir numara verdi; `board.js add` bunu yalnızca "already exists" diyerek reddetti, ardından gelen `task.js start` o numaradaki eski görevi başlatıp başlangıç commit'ini attı. Ret mesajı artık numarayı tutan görevi, başlığını ve durumunu yazıyor, o numaranın yeni görev için başlatılmamasını söylüyor ve bir sonraki boş numarayı veriyor (`--id` verilmeyebilir). `task.js start` görevin `title` alanını döndürüyor; uyuşmazlık hemen görünür.

## 1.3.19 değişiklikleri

- **Görev kapısı görevin değiştirdiğini test eder** (g55): `gate.js --task <id>` her görevde ve her turda tüm Rust çalışma alanını koşuyordu, görev tek bir uç crate'e dokunsa bile. Artık görevin `chore(team): <id> start` commit'inden beri değişen dosyaları bulur, `cargo metadata` ile paketlere eşler, onlara bağlı her paketi ekler ve `cargo test` ile `cargo clippy`'yi yalnız bunlar için `-p` ile koşar. Kilit dosyası, kök manifest ya da bir paketin dışındaki başka bir dosya, ya da başlangıç commit'i yoksa tüm çalışma alanı koşar; belgeler ve `.claude/`, `.github/` ayarları kapsamı genişletmez. Sonuçtaki `scope` hangisi olduğunu söyler. `--full` ya da `team/config.json` içinde `gateScope: "full"` bunu kapatır; kilometre taşı ve aşama sonu kapıyı `--task` olmadan koşar.

## 1.3.18 değişiklikleri

- **Takılan kontrol kapıyı tutmaz** (g54): bir core testi işlemci kullanmadan takıldı ve bir görevin kapısını 35 dakika tuttu; lider hiç gelmeyecek sonucu bekledi, koşu durdurulunca çıktısı da kayboldu ve hangi test olduğu görülemedi. Her kapı kontrolünün artık bir süre sınırı var: `team/config.json` içinde `gateCheckSeconds` (varsayılan 1200, 0 = sınırsız; tek koşu için `NAC_GATE_CHECK_SECONDS`). Sınır geçince kontrol tüm süreç ağacıyla (cargo ya da npm altındaki test ikilisi dahil) durdurulur ve `timedOut`, son satırları ve `hung` + `hangNote` ile kırmızı döner; not bunun bir takılma olduğunu ve testin nasıl bulunacağını söyler.

## 1.3.17 değişiklikleri

- **Yalnız sürüm artışı**: eklenti önbelleği 1.3.16'yı g52 eklenmeden önce almıştı; `/plugin update` sürümü değişmeyen önbelleği yenilemez. 1.3.17 birleştirilmiş 1.3.16 ile aynı kodu taşır, güncelleme g52 hook'unu getirir.

## 1.3.16 değişiklikleri

- **Liderin başlangıç bağlamı hook sınırının altında kalır** (g51): Claude Code 10.000 karakteri aşan hook bağlamını dosyaya yazar, oturuma yalnız kısa bir önizleme gösterir. Vekil bölümü eklenince liderin başlangıç bağlamı ~10,3 KB'a çıktı; 2026-10-20'den beri neredeyse her lider başlangıcı ve sıkıştırması yalnız ilk ~2 KB'ı aldı: lider talimatı, kurallar, vekil ve resume lidere ulaşmadı, `NAC-LEAD-ACTIVE` işareti önizlemenin dışında kaldığı için yeni lider "NAC yüklü değil" dedi. İşaret artık en başta, ardından vekil, resume ve kurallar gelir. Toplam 9.000 karakteri geçecekse lider talimatının yerine "önce `prompts/lead.md`'yi tümüyle oku" satırı konur; yine sığmayan resume notla kesilir.
- **Başka oturuma cevap gerçek alıcıyla kaydedilir** (g52): lider vekile cevap verirken gelen oturum adresini (`uds:\.pipe...`) `to` alanına kopyaladı, posta kaydı `to: unknown` dedi. `owner-proxy` thread'inde böyle bir adres artık `team/config.json`'daki vekil olarak, başka yerde `peer-session` olarak kaydedilir; `ad [ref]` biçimli alıcı adını korur.

## 1.3.15 değişiklikleri

- **Görevin derleme klasörleri worktree ile silinir** (g50): bir disk dolunca lider derlemeleri `CARGO_TARGET_DIR` ile başka diske taşıdı (`target-T-059`, ajan scratchpad'leri). Görev kapanınca worktree silindi ama bu klasörler kaldı, yaklaşık 60 GB; sonunda öbür disk de doldu ve ekip iki saatten fazla durdu. `worktree.js add` artık worktree'nin yanında bir `target` yolu yazar (`<kök>/target-<id>`), `worktree.js remove` oradaki her `target-<id>[-ek]` klasörünü worktree ile birlikte siler. task-loop skill'i derleme klasörünü worktree içinde ya da bu yolda tutmayı, scratchpad'e asla koymamayı, disk dolunca `worktreeRoot`'u taşımayı söyler.

## 1.3.14 değişiklikleri

- **Vekil kararı vekil kararı olarak kaydedilir** (g49): lider vekil cevabını sahibin kendi onayı gibi kaydetti, otomatik mod sınıflandırıcısı reddetti ve lider ondan sonra hiçbir vekil cevabını kaydetmedi. `decisions.js decide --by proxy` artık "by: owner proxy <oturum>" yazar ve sahibe ait soruları (push, merge, deploy, yayın, silme, geri dönüşsüz ya da para harcayan adımlar) reddeder. `setup.js --proxy` yetkiyi sahibin ağzından proje CLAUDE.md'sine owner-proxy bloğu olarak da yazar ve config ile birlikte commit eder.

## 1.3.13 değişiklikleri

- **Lider okuma koruması** (g48): lider kaynak dosyaları ve uzun çıktıları kendisi okudu, bağlamı hızla doldu ve otomatik sıkıştırma kilitlendi. Bir `PreToolUse` hook'u liderin kaynak dosyayı ya da 40 KB'den büyük dosyayı `Read` ile okumasını, en fazla 120 satırlık bir dilim değilse reddeder; roller etkilenmez. Lider talimatı uzun komut çıktısını dosyaya alıp sonunu okumasını söyler.

## 1.3.12 değişiklikleri

- **Sahip vekili koruması** (g47): bir sıkıştırmadan sonra lider vekile gidecek soruyu `AskUserQuestion` kutusuyla sordu; kutu tuş bekledi, vekilin cevabı arkasında kuyrukta kaldı. `ownerProxy` etkinken bir `PreToolUse` hook'u kutuyu reddeder ve soruyu `SendMessage` ile göndermesini söyler. Push, merge, deploy, yayın ve silme soruları kutuyla sorulur; vekil erişilemezse lider "Owner direct: <neden>" ile sahibe sorar.

## 1.3.11 değişiklikleri

- **Tur bütçesi durması tur sayılmaz** (g46): T-082b'de geliştirici iş parça parça ilerlerken iki kez tur bütçesinde durdu; ikisi de başarısız tur sayıldı ve üçüncüsü Opus'a gitti. `board.js round` artık `--reason gate|review|stuck` ister ve `--reason budget`'ı reddeder; model yalnız gerçek başarısızlıkta yükselir. Planner 3'ten fazla ayrı test edilebilir parçası olan brief'i böler.

## 1.3.10 değişiklikleri

- **Yalnız biçim yüzünden kırmızı gate tur sayılmaz** (g44): T-081 ve T-084'te gate yalnız `cargo fmt --check` yüzünden kırmızıydı ve geliştirici boşluk düzeltmek için yeniden çağrıldı. Gate artık yalnız düzeltme komutu olan kontroller kırmızıysa `fixable: true` der (kontrolün `fix` alanı ya da `cargo fmt`, `ruff format`, `black`, `prettier --check`'in yazan biçimi); `gate.js --task <id> --fix` düzeltmeleri çalıştırır, `style(<id>)` olarak commit eder ve gate'i yeniden koşar. Geliştirici kuralları da her commit öncesi biçimlendiriciyi çalıştırmayı söyler.

## 1.3.9 değişiklikleri

- **Files: satırındaki notlar** (g43): yolun ardındaki parantez içi not (`store.rs (read only, unless ...)`) yolu virgülünden bölüyordu; kod haritası mevcut dosyaları yeni gösterdi. Parantez içindeki virgül artık bölmez, notlar ve baştaki "new" atılır; planner notları ayrı satıra yazar.

## 1.3.8 değişiklikleri

- **Tur bütçesi zorlanır** (g36): rol kendi turlarını sayamadığı için pack'teki bütçe satırı tek başına yetmedi; bir geliştirici rapor ve commit olmadan `maxTurns` sert durağına çarptı. Yeni PostToolUse hook'u (`turn-budget.js`) rolün turlarını kendi kaydından sayar, son 5 turda adımı bitirmesini, `turnBudget`'ta durup yalnız yeşil işi commit edip raporlamasını söyler. `turnBudget` `maxTurns`'ün altında kalmalı.
- **Pack'te kod haritası** (g37): pack, brief'in adını verdiği dosyaların bildirimlerini satır numaralarıyla listeler; rol bu dosyaları tanımak için tur harcamaz. Planner artık her kod brief'ine tek bir `Files:` satırı yazar; bu satırı olmayan eski brief'te tırnak içindeki mevcut yollar kullanılır.
- **Engel kuralı** (g38): her rol brief'in öngörmediği bir engelde en fazla 3 tur harcar, sonra raporlar; engeli geçmek için test zayıflatılmaz.
- **Kapsam kaydı ve team/ dosyaları**: `task.js close` `team/metrics/scope-<id>.json` yazar (değişen dosyaların ne kadarını `Files:` satırı adlandırıyor, kalanlar türüne göre); bu, ileride kapsam kontrolü için bir kayıttır. Bir kod commit'inde `team/` dosyası varsa uyarır. Geliştirici kuralları artık hand-off'un kod commit'ine girmediğini söyler.
- **Bulgu düzeltme ve pack --ids** (g40): `findings.js amend <F-id> --file --line --symbol` açık bir bulgunun adresini add ile aynı denetimlerle düzeltir; `findings.js pack --ids` bir modülün bulgularının bir kısmını paketler.
- **Board başlığı** (g42): `board.js update <id> --title <metin>`.

## 1.3.7 değişiklikleri

- **Bulgu adresi dosya olmalı** (g35): bir dizine (`crates/bench/src:1`) kaydedilen bulgu `findings.js pack` komutunu EISDIR ile düşürüyor, sertleştirme paketi üretilemiyordu. `findings.js add` ve `task.js close --findings` artık dizin adresini reddeder (close hiçbir şey kaydetmeden durur); `pack` eski bir dizin adresini hata vermek yerine pakette not eder.

## 1.3.6 değişiklikleri

- **İzin commit mesajı iki script’i de anar**: `setup.js --permissions` `task.js` kuralını da eklediği halde `allow team-commit.js for the lead (g27)` diye commit ediyordu; mesaj artık `chore(nac): allow team-commit.js and task.js for the lead (g27, g33)`.

## 1.3.5 değişiklikleri

- **Liderin kayıt çağrıları azaldı** (g33): liderin çağrılarının yaklaşık üçte biri pano, ekip commit'i, devir notu ve bulgulara gidiyordu. `task.js start <id>` artık in-progress, taban commit'li devir notu iskeleti, worktree ve rolün paketini yapıp tek commit atar; `task.js note <id>` devir notuna ekler; `task.js close <id> --commit <sha> [--findings <dosya>] --lead-note <metin>` bulguları, done'ı (aynı retlerle), maliyet dosyasını ve sırası geldiyse lider devir notunu yazıp tek commit atar. Kurulumun izin kuralı `task.js`'i de kapsar; önceden kurulmuş projede bir kez `! node <yol>/scripts/setup.js --permissions` çalıştır.
- **Her görevden sonra taze lider** (g34): sıkıştırma ayarlıysa lider her görevden sonra döner (`/clear` ile 5'te bir; `team/config.json` içindeki `rotateEvery` ezer; `rotateBy` `clear` ya da `compaction` seçer, g76), lider devir notunu `task.js close` yazar. `! node <yol>/scripts/setup.js --compaction --window 100000` daha küçük bir `autoCompactWindow` (en az 100000) yazar; sıkıştırma yaklaşık her görev sonunda gelir.
- **Sıkıştırma artık takılmıyor** (g32): yumuşak koşullar (devir notu olmayan görev, commit edilmemiş `team/` dosyaları, bulunamayan done commit'i) otomatik sıkıştırmayı en çok `compaction.softMargin` token (varsayılan 20000) erteler, sonra bunları anan bir devir notuyla çalıştırır; yalnız açık sahip sorusu tavana kadar engeller.
- **Kapı çalışan kontrolü bekler** (g31): aynı kontrol programı zaten çalışıyorsa `gate.js` en çok `gateWaitSeconds` (varsayılan 300) bekler, hâlâ çalışıyorsa `busy` ve not verir; rollere testleri ön planda koşmaları, arka planda bırakmamaları söylenir.

## 1.3.4 değişiklikleri

- **Worktree silme board'u izler** (g30): `worktree.js remove` yalnız `<worktreeRoot>/<repo>-wt/<id>` altına bakıyordu; board'da başka yerde kayıtlı worktree bulunamıyor, git ile elle siliniyordu. Artık board'daki worktree'yi siler, kayıt yoksa hesaplanan yola düşer.

## 1.3.3 değişiklikleri

- **Vekil config'te** (g29): yalnız sohbette kararlaştırılan vekil oturumu bir sonraki lider oturumu tarafından bilinmiyordu; lider vekilin cevaplayamadığı soru kutusu açıyordu, kalıcı yetkiyi kendisi kaydetmesi de sınıflandırıcıda reddediliyordu. Artık bir kez `! node <yol>/scripts/setup.js --proxy <oturum> [--until YYYY-AA-GG]` ile ayarlarsın (`--proxy off` kaldırır); `team/config.json`'a `ownerProxy` olarak yazılır, her lider oturumu sahip sorularını o oturuma SendMessage ile gönderir. Push, ana dala merge, deploy, yayın ve verini silme yine sana gelir.

## 1.3.2 değişiklikleri

- **Pack ve gate görev worktree'sini izler** (g28): görev kendi worktree'sinde çalışırken `pack.js --base` diff'i, `gate.js --task` kontrolleri ana ağaçta alıyordu; pack boş çıkıyor, gate yanlış kodu denetliyordu. İkisi de artık board'da kayıtlı worktree'yi kullanır; kayıtlı ama olmayan worktree hata verir.

## 1.3.1 değişiklikleri

- **Lider ekip commit'i yapabilir** (g27): otomatik mod sınıflandırıcısı liderin `team-commit.js` çalıştırmasını reddediyordu, ekip commit'leri sana kalıyordu. Kurulum artık yalnız bu script için proje izin kuralı yazar (eklenti kökü ve dizin kaynaklı marketplace); önceden kurulmuş projede bir kez `! node <yol>/scripts/setup.js --permissions` çalıştır. Lider `team-commit.js`'i tek başına koşar, zincirlemez.

## 1.3.0 değişiklikleri

Her madde kapattığı açığı belirtir; ayrıntılar yukarıdaki bölümlerdedir.

- **Gate her kontrolü koşar** (g18): `gateCommands` test, lint ve biçim kontrollerini koşar; kurulum yığına göre varsayılanları doldurur.
- **Bağlam paketi zorunlu** (g22): kod rolleri, test mühendisi, son incelemeci ve veritabanı mühendisi paketsiz dispatch edilemez; `cost.js` paket oranı %100'ün altındaysa uyarır.
- **Geri alınamaz adımdan önce go-path testi** (g23): `--irreversible` onay sorusu, çalıştırılıp 0 ile biten bir go-path test komutu ve yeşil gate ister.
- **Bekletilen sorular** (g16): sahibin ertelediği sorular sıkıştırmayı artık engellemez.
- **Her yeşil adım commit'lenir** (g19): görevlere boyut etiketi; `board.js`, en fazla bir kod commit'i olan M/L görevi (boyutsuz görev M sayılır) `--single-commit <gerekçe>` olmadan bitirmez; `--code no` görevler muaftır.
- **Brief dışına çıkılmaz** (g21): geliştirici ek dalları soru olarak önerir; incelemeci brief dışı kodu bulgu yazar.
- **Kurulum kendi değişikliğini commit'ler** (g11): `--compaction` satır sonlarını ve girintiyi korur; `--apply` yalnız oluşturduğu ya da değiştirdiği dosyaları commit'ler.
- **Hand-off gerçek tetiği yazar** (g17): güvenli nokta mı tavan mı, hangi koşullar sağlanmadı ve gerçek sıradaki görev.
- **Bitişte maliyet dosyası** (g20): `board.js done` eksikse görev maliyet dosyasını kendisi yazar.
- **Hand-off soruları kayıttan** (g14), **gömülü sorular** (g13), **sıkıştırma açıkken hand-off ile rotasyon** (g15), **yalnız gerçek farkta sürüm kayması uyarısı** (g12).
- **Bir çalışma ağacında tek kod görevi** (g24): aynı ağaçta ikinci süren kod görevi reddedilir; `worktreeRoot` worktree yerini belirler.
- **Lider güvendeyken sıkıştırma** (g25): görevler sürerken de, `team/` commit'liyse, bekleyen soru yoksa ve her süren görevin hand-off'u varsa izinli; tavan 220000.
- **Bilinmeyen Q/D numaraları** (g26): Stop hook, liderin mesajında `decisions.md`'de olmayan Q ya da D numarasını işaretler.
- **Yalnız team/ commit'leri** (D-227): ekip durumu commit'leri `team-commit.js` ile yalnız `team/` yol kapsamını kullanır.
- Testler: testlerdeki git zamanlaması deterministik (sabit tarih ve kimlik, açık saatli önbellek testi).

## Lisans

MIT. Bazı bölümler Jesse Vincent'ın superpowers projesinden uyarlanmıştır; bkz. [NOTICE](NOTICE).

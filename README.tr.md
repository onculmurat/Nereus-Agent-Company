# Nereus Agent Company (NAC)

[English](README.md)

Tek bir kişiye, yapay zekâ ajanlarından oluşan bütün bir yazılım ekibi veren bir Claude Code eklentisi. Ne istediğinizi anlatırsınız; kendi Claude Code oturumunuzdaki ekip lideri işi böler, rolleri çalıştırır ve karar size ait olduğunda size sorar.

## NAC nedir, neden var

Bir ürünü tek başına geliştirmek her rolü üstlenmek demektir: mimar, geliştirici, gözden geçiren, güvenlik incelemecisi, yazar. NAC bu rollerin her birine kendi talimatları ve modeli olan ayrı bir ajan verir ve sizinle onların arasına bir lider koyar.

- Yalnız liderle (Claude Code oturumunuzla) konuşursunuz. Görev atamazsınız.
- Ekip sizin yerinize karar vermez. Ürün, kapsam ve tasarım seçimleri, dışa dönük işlemler (push, deploy, yayın) ve onaylı plandan sapmalar her zaman size soru olarak gelir.
- Ekibin bildiği her şey projenizde `team/` altında durur; iş yeniden başlatmalardan sonra da devam eder.

NAC'ın görsel bir arayüzü yoktur. Claude Code terminalinin içinde çalışır.

**v1 kapsamı.** Bu sürüm çekirdek rolleri (ekip lideri, mimar, planlayıcı, backend geliştirici, frontend geliştirici, veritabanı mühendisi, test mühendisi, kod incelemecisi, son incelemeci, güvenlik incelemecisi, doküman yazarı, asistan) ve 0, 3, 4, 5 ve 6. aşamaları içerir. Sonraki adımlar: v2 araştırmacı, ürün yöneticisi, UX ve UI tasarımcıları, DevOps mühendisi ile 1, 2 ve 7. aşamaları; v3 pazarlama ve iş rolleri ile 8 ve 9. aşamaları ekler.

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

Kurulum önce bir deneme çıktısı (dry run) gösterir: oluşturacağı her dosya, `.claude/settings.json` değişikliği (agent teams açık, NAC etkin) ve `.gitignore` satırı. Siz onaylamadan hiçbir şey yazılmaz. Var olan bir dosyanın ya da ayarın üzerine asla yazmaz; çakışan bir ayar kurulumu durdurur. Ardından ayrı bir soru olarak, genel `~/.claude/CLAUDE.md` dosyanızdaki model bölümünün NAC model tablosunu göstermesini isteyip istemediğinizi sorar. Son olarak `/clear` çalıştırın (ya da Claude Code'u yeniden başlatın): kurulumu yapan oturum NAC kurulmadan önce başladığı için lider talimatlarını ancak sonraki oturum yükler. Ardından lider 0. aşamayı başlatır.

Oturumunuz liderdir ve lider oturumunuzun modeliyle çalışır. Lider için `/model opus` kullanın.

### Kurulumun oluşturdukları

- `team/`: `config.json`, `brief.md`, `decisions.md`, `glossary.md`, `contracts/` ve `team/work/` (pano, devir notları, eskalasyonlar, posta kutusu, arşiv; git dışında).
- Proje belgeleri, her biri ayardan kapatılabilir: `memory.md`, `plan.md`, `article_dev.md`, `docs/setup-requirements.md`.

## Aşamalar

| Aşama | Roller | Çıktı | Onayınız |
|---|---|---|---|
| 0 Başlangıç | lider | Proje özeti: amaç, neden, rakipler, hayal, başarısızlık ölçütleri | evet |
| 3 Tasarım | mimar, güvenlik incelemecisi | Spec, sözleşmeler, tehdit modeli | evet |
| 4 Planlama | planlayıcı | Görev özetleri ve pano kayıtları | evet |
| 5 Geliştirme | geliştiriciler, veritabanı mühendisi, test mühendisi, kod incelemecisi, doküman yazarı | Görev başına: kod, test, inceleme, belge | yalnız kararlar için |
| 6 Son kontrol | son incelemeci, güvenlik incelemecisi | Bulgular ve düzeltmeler | evet |

Her aşama kısa bir aşama raporuyla (biten, karar verilen, açık kalan) biter; sonraki aşama ancak siz onaylayınca başlar. Aşamalar geri dönebilir: bir inceleme işi tasarıma geri gönderebilir.

## Roller ve modeller

| Rol | Sorumluluk | Model |
|---|---|---|
| ekip lideri (oturumunuz) | Sizinle konuşur, iş dağıtır, panoyu tutar, size sorar | oturum modeliniz |
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

Size gelen her soru aynı biçimdedir: **Kaynak** (nereden geldi, kim buldu), **Durum** (kod yazıldı mı, cevap mevcut işi değiştirir mi), **Etki**, seçenekler ve tek bir öneri. Her seferinde tek soru.

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

## Güvenlik kuralları

- Push, merge, deploy, yayın, gönderi, altyapı uygulama ya da satın alma; o işlem için ayrı ve açık onayınız olmadan yapılmaz.
- Kurulum ve temizlik her zaman önce deneme çıktısı gösterir ve var olan dosyaların üzerine yazmaz.
- Roller yalnız kendi sorumluluk alanında çalışır; incelemecilere dosya düzenleme aracı verilmez.
- Hook'lar bir NAC projesi dışında (`team/config.json` olmayan klasörde) hiçbir şey yapmaz.

## SSS

### NAC diğer projelerimi yavaşlatır mı?

Hayır. Açtığınız projeler dışında kapalıdır.

### Bir rolle doğrudan konuşabilir miyim?

Evet. Olağan muhatabınız liderdir, ama herhangi bir ekip üyesine mesaj gönderebilirsiniz.

### Bir görevin ortasında Claude Code'u kapatırsam ne olur?

Sonraki oturum bir devam özetiyle başlar: aşama, süren iş (`git status` ile), açık pano kayıtları, lider için okunmamış mesajlar ve sıradaki sorular.

### Ekip durumu commit'lenir mi?

`team/brief.md`, `decisions.md`, `contracts/`, `glossary.md` ve `config.json` commit'lenmek içindir. `team/work/` git dışındadır.

## Lisans

MIT. Bazı bölümler Jesse Vincent'ın superpowers projesinden uyarlanmıştır; bkz. [NOTICE](NOTICE).

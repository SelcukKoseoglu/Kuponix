# Kuponix

**Kuponunu oluştur. Senaryolarını karşılaştır.**

Kuponix, kullanıcının elle girdiği bahis seçimlerini, oranları, tahmini olasılıkları ve bütçeyi kullanarak şu alternatifleri aynı bütçe altında karşılaştıran bir **kupon portföyü optimizasyon aracıdır**:

1. normal kombine kuponlar,
2. sistem kuponları,
3. normal + sistem karma portföy,
4. **hiç kupon oluşturmama**.

> Kuponix yalnızca kullanıcının girdiği verilerle matematiksel senaryolar oluşturur. Tahminler ve simülasyonlar belirsizlik içerir; kazanç garantisi vermez. Yalnızca kaybetmeyi göze alabileceğiniz tutarı kullanın.

Kuponix maç sonucu tahmin etmez, kullanıcı yerine bahis oynamaz. Harici oran API'si, scraping, kullanıcı hesabı, ödeme veya veritabanı yoktur.

## Kurulum ve çalıştırma

Gereksinim: Node.js 16.17+ ve npm 8+.

```bash
cd coupon-optimizer/frontend
npm install
npm run dev        # http://localhost:5173
npm test           # unit testler (Vitest)
npm run typecheck  # TypeScript tip kontrolü
npm run build      # üretim derlemesi → dist/
npm run preview    # derlenmiş sürümü yerelde sun
```

Vercel'de **Root Directory** `coupon-optimizer/frontend` olmalıdır. Ortam değişkeni gerekmez.

## Mimari

Belge Python + FastAPI backend'i tercih ediyor, ancak "çalışan bir mimari varsa gerekçesiz değiştirme" kuralını da koyuyor. Uygulama Vercel'de statik çalışıyor; ayrı bir Python sunucusu barındırma, maliyet ve bakım yükü getirirdi. Bu yüzden hesap motoru **TypeScript'te, arayüzden tamamen ayrı saf modüller** olarak yazıldı.

Analiz bir **Web Worker**'da çalışır; arayüz donmaz ve 30 sn zaman aşımı vardır. Modül worker desteklenmeyen tarayıcılarda aynı hesap ana iş parçacığında yapılır.

```text
frontend/src/
  engine/                     Hesap motoru (UI'dan bağımsız, testli)
    config.ts                 Merkezi yapılandırma: stratejiler, belirsizlik, limitler, skor ağırlıkları
    selectionAnalyzer.ts      İma edilen olasılık, Edge, EV, Kelly, güven → belirsizlik aralığı
    correlation.ts            Bağımlılık grupları, ortak olasılık doğrulaması, senaryo uzayı (tam sayım / Monte Carlo)
    systemFormats.ts          Dinamik sistem formatları
    optimizer.ts              Aday kupon üretimi + portföy optimizasyonu
    scenarios.ts              Bir portföyün her senaryodaki brüt dönüşü
    riskMetrics.ts            Beklenen getiri, olasılıklar, P5, Expected Shortfall, histogram
    exposure.ts               Seçim/maç maruziyeti (ortak seçim yoğunlaşması)
    utility.ts                Strateji faydası (CRRA / log servet) ve kesinlik eşdeğeri
    decision.ts               Sistem karar motoru, verimlilik skoru, Pareto
    analyze.ts                Uçtan uca analiz akışı (belge §10)
    worker.ts, client.ts      Web Worker ve zaman aşımı/hata yönetimi
  lib/                        Kupon hesapları (kuruş), plan, doğrulama, depolama, sonuçlandırma
  features/                   selections, settings, analysis, portfolio, system-betting, scenarios, risk, slips, data
  data/                       Takım ve bahis seçimi listeleri
```

## Veri modeli

Her seçim için:
- `matchId`: aynı maçtaki seçimleri gruplar; formda "Maç" listesinden veya "+ Bu maça seçim ekle" ile seçilir.
- `matchName`, `marketSelection`, `odds` (> 1, en fazla 2 ondalık), `minMatches`.
- `confidence` (1–10): tahmine ne kadar güvenildiği.
- `estimatedProbability` (0–1, isteğe bağlı): kullanıcının tahmini kazanma olasılığı.
- `correlationGroup` (isteğe bağlı): farklı maçları ilişkili saymak için.
- `note`, `result` (tuttu / tutmadı / iade).

**Tahmini olasılık ve güven puanı ayrıdır.** Güven puanı olasılığa çevrilmez. Tahmini olasılık girilmemiş seçimde EV, Edge ve Kelly "Tahmin gerekli" görünür ve seçim portföylere alınmaz. İma edilen olasılık, tahminin yerine sessizce kullanılmaz.

İsteğe bağlı olarak, aynı maçtaki iki seçim için **birlikte gerçekleşme olasılığı** girilebilir. Değer `max(0, pA+pB−1) ≤ pAB ≤ min(pA, pB)` aralığında olmalıdır; aksi halde reddedilir.

## Formüller

| Metrik | Formül |
|---|---|
| İma edilen olasılık | `1 / oran` (marjdan arındırılmamış ham değer) |
| Edge | `tahmini − ima edilen` (yüzde puan) |
| EV | `p · oran − 1` (tahmin doğruysa 1 TL başına beklenen net getiri) |
| Kelly | `(p · o − 1) / (o − 1)`. ≤ 0 ise stake önerisi yok; > 0 ise Quarter Kelly yalnızca referans olarak gösterilir. Portföye doğrudan uygulanmaz. |
| Belirsizlik aralığı | `p ± w(güven)`; `w` güven 1'de 0,20, güven 10'da 0,02 (doğrusal). [0,01; 0,99] aralığına sınırlanır. Kalibre edilmemiştir. |
| Normal kupon dönüşü | `tutar × Π oranlar` (tüm seçimler kazanırsa) |
| Sistem kolon sayısı | `Σ C(n, j)`, j ∈ formattaki boyutlar (ör. Sistem 3,4 için 4 + 1 = 5) |
| Kolon dönüşü | `kolon tutarı × Π kolon oranları`; sistemin dönüşü yalnızca kazanan kolonların toplamıdır |
| Senaryo olasılığı (bağımsız) | `Π p_i (kazananlar) × Π (1 − p_i) (kaybedenler)` |
| P5 | net sonucun 5. yüzdelik dilimi |
| Expected Shortfall %5 | en kötü %5'lik olasılık kütlesindeki ortalama net sonuç (negatif = kayıp; sınırda kısmi ağırlık) |

Para hesapları kuruş cinsinden tam sayıdır. Kupon dönüşleri `BigInt` ile kesin hesaplanır. Sistem tutarı kolonlara bölünürken kalan kuruşlar **ilk kolonlara birer birer** dağıtılır; kolon tutarlarının toplamı sistem tutarına tam eşittir.

## Motorun işleyişi (belge §10)

1. Girdiler doğrulanır ve her seçim tekil olarak analiz edilir.
2. Tahmini olasılık eksikleri ve aynı maç/korelasyon grupları belirlenir.
3. **Aday kuponlar** üretilir:
   - 1–4 seçimli tüm normal kuponlar ve 3–5 seçimli tüm alt kümelerin tüm sistem formatları taranır.
   - Daha büyük kuponlar, üç sıralamanın (EV, olasılık, olasılık/oran) ilk n seçiminden kurulur; bu "yaklaşık çözüm" olarak etiketlenir.
   - Aynı maçtan veya gruptan iki seçim aynı kupona konmaz.
   - Bütçeye ya da kolon tutarı sınırlarına sığmayan formatlar elenir.
4. **Dinamik sistem formatları:** n seçim için tek boyut (`Sistem j`), ardışık ikili (`Sistem j,j+1`) ve üst aralık (`Sistem k,…,n`), 2 ≤ j < n. Sabit bir seçim sınırı yoktur. Bunlar matematiksel formatlardır; platformda oynanabilirliği kullanıcı doğrulamalıdır.
5. **Senaryo uzayı** kurulur:
   - Senaryo sayısı 16.384'ü aşmıyorsa tam sayım, aşıyorsa tohumlu Monte Carlo kullanılır (ayarlanabilir sayı ve tohum).
   - Optimizasyon daha küçük bir kümeyle (4.096 senaryoya kadar tam, üstünde 2.048 örnek) çalışır.
   - Raporlanan metrikler tam ölçekte yeniden hesaplanır.
6. **Portföy optimizasyonu:** Kuponlar tek tek değil, birlikte optimize edilir; aynı seçimi paylaşan kuponların birlikte kazanıp kaybettiği hesaba girer.
   - Bütçe birimlere bölünür (200 TL ve üstünde 10 TL).
   - Stratejinin faydasını en çok artıran birimler açgözlü yöntemle eklenir, ardından aktarma ve kapatma hamleleriyle yerel iyileştirme yapılır.
   - **Fayda artmıyorsa hiçbir şey eklenmez.** Bütçenin tamamını kullanmak hedef değildir; kalan tutar "kalan bütçe" olarak gösterilir.
7. Her strateji için **normal ağırlıklı, sistem ağırlıklı, karma ve kupon oluşturmama** alternatifleri değerlendirilir:
   - Tekrar eden portföyler tekilleştirilir ve Pareto analizi yapılır.
   - En yüksek optimizasyon skoru 0'dan (kupon oluşturmamadan) büyük değilse strateji **"Kupon oluşturmama"** önerir.
8. **Sistem karar motoru** sistemin neden önerildiğini veya önerilmediğini hesaplanan metriklerle açıklar:
   - normal kupon dönmezken sistemin dönüş sağlama olasılığı
   - beklenen net, tam kayıp, P5 ve ES farkları
   - maruziyet farkı ve stres altındaki fark
   - kolon başı tutar ve dışlanan kolon oranı
   - format karşılaştırma tablosu ve şeffaf verimlilik skoru

Sistem kuponu "daha çok kombinasyon kapsadığı" için tercih edilmez.

### Stratejiler (`engine/config.ts`)

| Strateji | Fayda | Olasılık | Aynı maç/grup | Seçim / maç maruziyeti | Seçim başına kupon | Bütçe tavanı |
|---|---|---|---|---|---|---|
| Kontrollü | CRRA γ = 2 | karamsar alt değer (`p − w`) | tam pozitif bağımlılık (stres) | %35 / %35 | 2 | %60 |
| Dengeli | CRRA γ = 2 | tahmin | bağımsızlık varsayımı | %60 / %60 | 3 | %100 |
| Agresif | log servet (γ = 1, tam Kelly büyümesi) | tahmin | bağımsızlık varsayımı | %100 / %100 | 4 | %100 |

- Fayda `u(w) = ln w` (γ = 1) veya `(w^(1−γ) − 1)/(1−γ)` biçimindedir; `w = (bütçe − yatırılan + brüt dönüş) / bütçe`.
- Her şey kaybedilirse `w = 0` ve `u = −∞` olur; bu yüzden **hiçbir strateji bütçenin tamamını riske atmaz**.
- **Optimizasyon skoru**, faydanın kesinlik eşdeğeri net getirisidir (TL karşılığı); kazanma olasılığı değildir.
- Negatif beklenen değerli portföylerin skoru 0'ın altında kalır ve önerilmez.
- Kullanıcı ayarları (en fazla kayıp, seçim/maç maruziyeti, kupon türleri, kolon başı alt/üst, sistem alt tutarı) strateji varsayılanlarının önüne geçer.
- Kontrollü strateji bilinçli olarak ihtiyatlıdır: karamsar tahminlerle hiçbir aday kupon oluşturmamadan iyi değilse kupon önermez.

### Korelasyon modeli

- Farklı maçlar bağımsız kabul edilir.
- Aynı maç veya kullanıcı korelasyon grubu için korelasyon katsayısı uydurulmaz. İki geçerli model kullanılır:
  - **Bağımsızlık varsayımı** (Dengeli, Agresif): açıkça etiketlenir ve uyarı verilir.
  - **Tam pozitif bağımlılık** (Kontrollü ve her kartın "stres" metrikleri): grup için tek bir `U ~ Uniform(0,1)` çekilir; seçim, `U < p_i` ise kazanır. Bu, verilen marjinallerle tutarlı geçerli bir ortak dağılımdır (Fréchet üst sınırı) ve ortak kayıpları en sık birlikte üretir.
- Kullanıcı ortak olasılık girdiyse ve değer geçerliyse o kullanılır.
- Geçersiz dağılım üretilmez. Karamsar modelde ortak olasılık marjinallerle çelişirse en yakın geçerli değere çekilir ve bu not edilir.

## Varsayımlar ve bilinen sınırlamalar

- **Olasılıklar kullanıcının tahminleridir.** Güven → belirsizlik eşlemesi ve strateji parametreleri kalibre edilmiş istatistik değil, yapılandırılabilir ürün tercihleridir.
- **Teknik sınırlar** (bahis kuralı değildir):
  - aynı anda en fazla 16 seçim değerlendirilir (fazlası EV'ye göre budanır ve uyarılır)
  - bir sistem kuponunda en fazla 16 seçim olabilir
  - bir portföyde en fazla 4 kupon olabilir
- **Büyük kuponlar yaklaşık aranır:** 5'ten fazla seçimli kupon ve sistemler tüm kombinasyonlar yerine sıralama önekleriyle aranır. Monte Carlo kullanılan sonuçlar "yaklaşık çözüm" olarak işaretlenir ve beklenen net için %95 örnekleme belirsizliği gösterilir.
- **Kolonsuz hesap yaklaşıklığı:** çok kolonlu sistemlerde (256 kolondan fazla) senaryo dönüşleri kolonlar dolaşılmadan, kolon başı ortalama tutarla hesaplanır; birkaç kuruş sapabilir. Sonuçlandırma her zaman kolon kolon kesindir.
- **Format tablosu yaklaşıktır:** sistem formatı karşılaştırma tablosu hız için optimizasyon senaryo kümesiyle hesaplanır.
- **Pareto ve skor farklı şeyler ölçer:** Pareto analizi dört özet metriğe (beklenen net, P5, ES, tam kayıp) dayanır. Optimizasyon skoru ise dağılımın tamamını değerlendirdiği için, Pareto dışı görünen bir portföy en yüksek skoru alabilir.
- **Platform kuralları varsayılmaz:** kesinti, vergi, ödeme ve kolon başı alt sınır dahil değildir; kolon başı sınırları ayarlardan girilir. Normal kupon en az 50 TL'dir; sistem kuponu varsayılan olarak en az 50 TL'dir (ayarlanabilir).
- **Hesaplama süresi:** 15 seçimlik bir analiz masaüstünde yaklaşık 2 saniye sürer; worker'da çalıştığı için arayüz donmaz, telefonda daha uzun sürebilir.

## Veri, uyumluluk ve yedekleme

- Veriler `localStorage` içinde `kupon-planlayici:v1` anahtarında tutulur: seçimler, sonuçlar, bütçe, ayarlar, ortak olasılıklar ve kayıtlı kuponlar.
- Veri sürümü 3'tür. Eski kayıtlar (sürüm 1–2) **kayıpsız taşınır**:
  - maç kimliği maç adından türetilir
  - eski "Sistem k..n" kayıtları boyut listesine çevrilir
  - eski risk tercihi "öne çıkarılan strateji" olur
- Kayıt okunamazsa, üzerine yazılmadan önce `kupon-planlayici:yedek:<zaman>` anahtarına yedeklenir.
- **JSON dışa/içe aktarma** sürüm 1–3'ü destekler ve şemayı doğrular; bozuk dosya mevcut veriyi değiştirmez.
- `localStorage` adrese bağlıdır; cihazlar veya adresler arasında taşımak için JSON dışa/içe aktarmayı kullanın.

## Testler

`npm test` 11 dosyada 88 test çalıştırır. Belgenin §15 listesiyle eşleşmesi:

| Belge maddesi | Test dosyası |
|---|---|
| 1–6 Tekil analiz (ima edilen, Edge, EV, eksik tahmin, Kelly, güven ≠ olasılık) | `engine/__tests__/selectionAnalyzer.test.ts` |
| 7–9 Sistem 3,4 = 5 kolon, 6 seçim için dinamik formatlar, sabit 4 sınırı yok | `engine/__tests__/systemFormats.test.ts`, `lib/__tests__/calculator.test.ts` |
| 10–14 Kolon oranı, kolon tutarları ≤ toplam, deterministik kuruş dağıtımı, kolon bazında min. maç, dışlanan kolonların nedenleri | `lib/__tests__/calculator.test.ts`, `lib/__tests__/payout.test.ts` |
| 15–19 Aynı maç grubu, maruziyetin toplanması, ortak seçim yoğunluğu, bağımsızlık sessizce varsayılmaz, geçersiz ortak olasılığın reddi | `engine/__tests__/correlation.test.ts`, `engine/__tests__/riskMetrics.test.ts` |
| 20–27 Bütçe, 50 TL, normal + sistem birlikte, maruziyet limitleri, tekilleştirme, üç strateji, kupon oluşturmama, avantaj yoksa sistem önerilmez | `engine/__tests__/portfolio.test.ts` |
| 28–35 Tam sayım, olasılık toplamı 1, aynı maç uyarısı, tohumlu Monte Carlo, pozitif net, tam kayıp, P5/ES, simülasyon bilgisi | `engine/__tests__/correlation.test.ts`, `engine/__tests__/riskMetrics.test.ts`, `engine/__tests__/portfolio.test.ts` |
| 36–38 JSON içe/dışa aktarma, bozuk JSON, localStorage, sürüm geçişi | `lib/__tests__/storage.test.ts` |
| 39–40 Mobil kullanım, "Hesaplanamadı" gösterimi | Uçtan uca WebKit (iPhone boyutu) kontrolü; aşağıda |

Ek olarak sonuçlandırma (`settlement.test.ts`), arama (`search.test.ts`) ve form doğrulaması (`validation.test.ts`) test edilir.

**Uçtan uca kontrol (manuel betik, depoda değil):** Playwright WebKit ve iPhone 13 görünümüyle şunlar doğrulandı:
- eski v2 verisinin korunması ve "Tahmin gerekli" / "Hesaplanamadı" gösterimi
- üç strateji kartı ve kupon oluşturmama kartı
- detay paneli, alternatifler, sistem kararı ve histogram
- formdan aynı maça seçim ekleme
- yenileme sonrası kalıcılık
- bozuk JSON'un reddedilmesi
- yatay taşma ve konsol hatası olmaması

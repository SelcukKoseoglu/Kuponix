# Kupon Planlayıcı

Kendi girdiğin maç/bahis seçimleri, oranlar, minimum maç koşulları ve güven puanlarıyla bütçeni normal ve sistem kuponlarına dağıtan, ardından maç sonuçlarını işaretledikçe kâr/zararını hesaplayan tek kullanıcılı bir web uygulaması.

> Bu araç yalnızca matematiksel kupon senaryoları oluşturur; kazanç garantisi vermez. Yalnızca kaybetmeyi göze alabileceğiniz bütçeyi kullanın.

- Maç sonucu tahmini yapmaz. Harici oran API'si, scraping, hesap veya ödeme sistemi yoktur.
- Veritabanı yoktur: veriler tarayıcıdaki `localStorage` içinde tutulur ve JSON olarak dışa/içe aktarılabilir.
- Backend yoktur: tüm hesaplama TypeScript tarafında, arayüzden ayrı saf fonksiyonlarla yapılır (`frontend/src/lib`). `.env` gerekmez.

## Kurulum ve çalıştırma

Gereksinim: Node.js 16.17+ ve npm 8+.

```bash
cd coupon-optimizer/frontend
npm install
npm run dev        # http://localhost:5173
```

```bash
npm test           # unit testler (Vitest)
npm run typecheck  # TypeScript tip kontrolü
npm run build      # üretim derlemesi → dist/
```

> `localStorage` adrese (origin) bağlıdır. Kayıtların görünmesi için uygulamayı hep aynı adresten açın (varsayılan `http://localhost:5173`). Başka bir port veya derlenmiş sürüm, ayrı ve boş bir depolama görür. Taşımak için **JSON dışa aktar / içe aktar** kullanın.

## Kullanım akışı

1. Bütçeni gir ve seçimlerini ekle: ev sahibi ve deplasman, bahis, oran, min. maç, güven 1–10, isteğe bağlı not.
   - **Takımlar** aranarak seçilir. Liste Süper Lig, Premier Lig, La Liga, Serie A, Bundesliga, Ligue 1 ve verilen Avrupa kupası takımlarını içerir; son sezonlarda lige çıkan ve düşen takımlar da listededir. Arama Türkçe karakter ve kısaltma farkını yok sayar (`besiktas`, `BJK`, `gs`, `psg`). Listede olmayan takım olduğu gibi yazılabilir; bir kez girilen takım sonraki aramalarda çıkar.
   - **Bahis seçimleri** hazır listeden aranır (`ms1`, `2,5 üst`, `kg var`, `1 & üst`…). Liste maç sonucu, çifte şans, alt/üst, KG, ilk yarı, İY/MS, kombineler, handikap, toplam gol, takım golü, korner, kart ve oyuncu özel seçimleri içerir. Oyuncu özel seçimde (ör. `Gol Atar – `) oyuncu adı sona yazılır. Sık kullanılanlar için hızlı seçim düğmeleri vardır, listede olmayan seçim de yazılabilir.
2. Risk tercihini seç ve **Kuponları öner**'e bas. Uygulama alternatif listesi değil, **tek bir kupon seti** önerir. Bu set tek bir kupon da olabilir, 2–4 normal/sistem kuponuna bölünmüş bir dağılım da.
3. Kuponları oynadıysan **Bu kuponları oynadım, kaydet** ile kaydet. Kayıt, maçların o anki oranlarını saklar.
4. Maçlar bittikçe seçimler listesinde her maçı **Tuttu / Tutmadı / İade** olarak işaretle. **Oynadığım kuponlar** bölümü şunları gösterir:
   - her kuponun dönüşünü,
   - setin net kâr/zararını,
   - sonuçlanan tüm setlerin toplamını.

## Öneri nasıl hesaplanır?

“Hepsini tek kupona mı yatırmalı, yoksa bölmeli mi?” sorusunun cevabı her maçın tutma ihtimaline bağlıdır. Uygulamada bu ihtimalin tek kaynağı senin güven puanındır.

- **Öznel olasılık:** `güven / 10` (7 → %70), en fazla %95. Maçlar birbirinden bağımsız sayılır. Bu gerçek bir olasılık değildir; öneri, tahminlerin ne kadar isabetliyse o kadar iyidir.
- **Aday kuponlar:** Kupon ve sistem boyutuna ayrıca bir sınır yoktur; havuzdaki bütün maçları kapsayan bir sistem (ör. 15 maçta `Sistem 14,15`) veya kombine de önerilebilir.
  - 1–4 maçlık normal kuponların ve 3–5 maçlık `Sistem k,…,n` kuponlarının tüm kombinasyonları taranır.
  - Daha büyük kombineler ve sistemler (6 maçtan havuzdaki tüm maçlara kadar, her k ile) üç sıralamanın ilk n maçından kurulur: öznel beklenen dönüş (olasılık × oran), güven ve güven ÷ oran. Tüm kombinasyonları taramak 15 maçta milyonlarca aday demektir; bu yüzden büyük boyutlarda bu öneklerle sınırlı kalınır.
  - 50 TL alt sınırına sığmayan biçimler (kolon sayısı bütçeye göre çok fazla olanlar) aday yapılmaz.

  Aynı maçtan iki seçim aynı kupona konmaz. Min. maç kuralına uymayan kolonlar atılır.
- **Kolonsuz hesap:** Bir sonuçta kazanan maçlar belliyken, bir sistemin kazanan kolonlarının toplam dönüşü kazananların oranlarından tek döngüyle bulunur (elementer simetrik polinomlar; min. maç kuralı dahil). Böylece binlerce kolonlu sistemler kolon kolon dolaşılmadan değerlendirilir. Kolon kolon saymayla aynı sonucu verdiği testlerle doğrulanır.
- **Ortak hareket:** Aday kuponların ödemeleri havuzdaki maçların sonuçları üzerinden hesaplanır; böylece aynı maçı paylaşan kuponların birlikte kazanıp kaybettiği hesaba katılır. Havuz 12 maça kadarsa tüm 2^m sonuç kesin olarak kullanılır. Daha büyük havuzlarda dağıtım kararı, sabit tohumlu 4.096 örnek senaryoyla verilir; aynı girdi her zaman aynı öneriyi verir. Ekranda gösterilen olasılık ve beklenen dönüşler ise her zaman kesin hesaplanır.
- **Hedef:** `beklenen dönüş − λ × standart sapma`. λ risk tercihine göre değişir:

  | Risk tercihi | λ | Tipik sonuç |
  |---|---|---|
  | Temkinli | 1 | Bütçe birkaç kupona yayılır, hiç dönüş alamama ihtimali düşer |
  | Dengeli | 0,5 | Beklenen kâr ile risk dengelenir |
  | Maksimum beklenen kâr | 0 | Beklenen dönüş en yükseğe çıkarılır; bütçe yine sistem ağırlıklı en az 2 kupona bölünür |

- **Dağıtım:** Bütçe birimlere bölünür: 200 TL ve üstünde 10 TL, 50–200 TL arasında 5 TL, daha azında 1 TL. Birimler, hedefi en çok artıran kuponlara açgözlü yöntemle dağıtılır. Sonra kuponlar arasında tutar aktarılarak yerel iyileştirme yapılır ve en iyi sonuç birkaç farklı başlangıçtan seçilir.
- **Maç başına sınır yok:** Bir maçın kaç kupona gireceği sınırlanmaz; algoritma bir maçı uygun görürse o maç tüm kuponlarda yer alabilir. Öneri ekranındaki **Maç bazında risk** tablosu her maç için kaç kupona girdiğini, yatarsa bütçenin yüzde kaçının yandığını (maçı içeren normal kuponlar + sistemlerde o maçı içeren kolonlar) ve yalnız o maç yatarsa toplam dönüşü bilgi olarak gösterir.
- **Sistem ağırlıklı dağılım (tüm risk tercihlerinde):** Uygulamanın amacı sistem ağırlıklı kuponlardır. Bu yüzden sistem kurulabiliyorsa (min. maç koşullarına uyan, farklı maçlardan en az 3 seçim) öneride en az bir sistem kuponu bulunur ve **bütçenin en az yarısı sistem kuponlarına** gider. Bütçe en az 100 TL ise **en az 2 kupona** bölünür; hiçbir tercih bütçenin tamamını tek kupona koymaz. Hangi sistemlerin, hangi maçlarla ve ne kadar tutarla oynanacağına optimizer karar verir. Kurallar karşılanamazsa sırayla gevşetilir (önce sistem payı, sonra sistem zorunluluğu, en son bölme kuralı) ve nedeni öneride yazılır.
- **Kısıtlar:**
  - en fazla 4 kupon,
  - **her kupon (normal ve sistem) en az 50 TL**; bütçe 50 TL'nin altındaysa öneri üretilmez,
  - toplam tutar bütçeyi aşmaz ve bütçenin tamamı dağıtılır (sistem kolonlarının kuruş yuvarlaması hariç).
- **Karşılaştırma:** Önerinin yanında, bütçenin tamamını tek normal veya tek sistem kuponuna koymanın beklenen dönüşü, kâr ihtimali ve sıfır dönüş ihtimali gösterilir. Böylece önerinin nedeni görülebilir.
- **Havuz sınırı:** Sonucu işaretlenmiş maçlar yeni öneriye alınmaz. Aynı anda en fazla 16 seçim değerlendirilir; daha fazlası varsa `güven × oran` değeri en yüksek 16 seçim alınır. Bu bir kupon kuralı değil, tarayıcıda hesap süresini makul tutan teknik sınırdır (15 maçta bir öneri yaklaşık 0,5–1 saniye sürer). Bir sistem kuponunda da en fazla 16 seçim olabilir.
- **Kolon başına tutar:** Çok kolonlu sistemlerde kolon başına tutar kuruşlara kadar düşebilir (ör. 16.278 kolon × 0,01 TL). Bahis platformunun kolon başı asgari tutarını ayrıca kontrol et.
- **Negatif beklenti:** Güven puanlarına göre bile beklenen dönüş yatırımın altındaysa uyarı gösterilir.

## Kupon kuralları

- **Normal kupon:**
  - En az 50 TL (her kupon için geçerli alt sınır).
  - Dönüş = tutar × oranların çarpımı.
  - Kupondaki maç sayısı her seçimin min. maç değerine eşit veya ondan büyük olmalıdır.
- **Sistem kuponu:**
  - `Sistem k,…,n`: n seçimin k'lı, …, n'li tüm kombinasyonları. Kolon sayısı = Σ C(n, j).
  - Min. maç kuralı her kolon için ayrı uygulanır ve geçersiz kolonlar atılır.
  - Tutar geçerli kolonlara bölünür ve kolon başına tutar kuruşa aşağı yuvarlanır.
  - Sistem kuponunun fiilen oynanan tutarı (kolon başına tutar × kolon sayısı) da en az 50 TL olmalıdır. Kuruş yuvarlaması tutarı 50 TL'nin altına düşürürse kupon reddedilir. Kolon başına ayrıca bir asgari tutar varsayılmaz; platform kurallarını kontrol et.
- **Sonuçlandırma:**
  - Bir kolon veya normal kupon, içindeki bir maç tutmazsa kaybeder.
  - **İade** edilen maçın oranı 1,00 sayılır.
  - Bekleyen maç varken set “devam ediyor” görünür. Bu durumda kesinleşmiş dönüş ve bekleyenler tutarsa ulaşılabilecek toplam dönüş ayrı ayrı gösterilir.
- **Para hesabı:** Tüm tutarlar kuruş cinsinden tam sayıdır. Dönüşler `BigInt` ile kesin hesaplanır. Gösterilen tutarlar kesinti ve vergi hariç brüt tutarlardır.

## Veri, uyumluluk ve yedekleme

- Veriler `localStorage` içinde `kupon-planlayici:v1` anahtarında tutulur: seçimler (sonuçlarıyla), bütçe, risk tercihi ve kayıtlı kuponlar.
- **Eski kayıtlar korunur.** Sürüm 1 formatındaki veriler (sonuç ve kayıtlı kupon alanı olmayan) otomatik okunur ve yeni formata taşınır.
- Kayıt herhangi bir nedenle okunamazsa, ham metin üzerine yazılmadan önce `kupon-planlayici:yedek:<zaman>` anahtarına kopyalanır.
- **JSON dışa/içe aktar** iki sürümü de destekler. İçe aktarmada şema doğrulanır; bozuk dosyada mevcut veri değişmez.
- **Tüm verileri temizle** onay ister ve kayıtlı kuponları da siler.

## Proje yapısı

```text
frontend/src/
  data/              Varsayılan takım ve bahis seçimi listeleri
  components/        Bütçe alanı, risk seçici, aranabilir giriş alanı, istatistik kutusu, sorumlu oyun notu
  features/
    selections/      Seçim formu, seçim listesi, Tuttu/Tutmadı/İade düğmesi
    plans/           Önerilen kupon seti, kupon özetleri, detay ve tutar düzenleme
    slips/           Oynanan kuponlar ve kâr/zarar
    data/            JSON dışa/içe aktarma, temizleme
  lib/
    money.ts         Kuruş bazlı para işlemleri
    validation.ts    Doğrulamalar, maç adı birleştirme/ayırma
    search.ts        Türkçe uyumlu takım/bahis araması
    risk.ts          Maç bazında risk analizi
    combinatorics.ts Kombinasyonlar, sistem kolon sayısı
    calculator.ts    Normal/sistem kupon hesapları
    plan.ts          Kupon setini doğrulayıp hesaplar
    probability.ts   Öznel olasılık modeli, dağılım istatistikleri
    payout.ts        Kolonsuz sistem dönüşü, sonuç kümeleri (kesin/örnek)
    optimizer.ts     Bütçe dağılımı optimizasyonu
    settlement.ts    Maç sonuçlarına göre kupon dönüşü ve kâr/zarar
    storage.ts       localStorage, JSON şeması, sürüm geçişi
```

## Testler

`npm test`, 7 dosyada 72 test çalıştırır:

| Dosya | Kapsam |
|---|---|
| `calculator.test.ts` | Oran çarpımı ve dönüş, Sistem 3,4 = 5 kolon, min. maç kolon dışlama, normal ve sistem kuponunda 50 TL sınırı, kuruş yuvarlama |
| `optimizer.test.ts` | Bütçe aşılmaması, tek öneri, risk tercihlerinin etkisi, maç başına sınır olmaması, tüm tercihlerde sistem ağırlıklı dağılım (en az %50 sistem, en az 2 kupon) ve gevşetme, küçük bütçede 50 TL sınırı, sonuçlanmış maçların dışlanması, aynı maç kısıtı, 16+ seçimde havuz budama ve performans |
| `payout.test.ts` | Kolonsuz sistem hesabının kolon kolon saymayla aynı sonucu vermesi (min. maç dahil), örnek senaryoların tekrarlanabilirliği, 15 maçlık sistem kuponu, büyük sistemlerin öneriye girmesi |
| `search.test.ts` | Takım ve bahis listelerinin içeriği (3.5/4.5 kombineleri dahil); Türkçe karakter, kısaltma ve yazım farklarıyla arama; hızlı düğmelerle birleştirme |
| `settlement.test.ts` | Tuttu/tutmadı/iade/bekliyor durumlarında normal ve sistem kupon dönüşü, kâr/zarar; öznel olasılık istatistikleri |
| `storage.test.ts` | JSON içe/dışa aktarma, sürüm 1 kayıtlarının okunması, bozuk kaydın yedeklenmesi |
| `validation.test.ts` | Oran, güven, min. maç ve bütçe validasyonları; takım alanları, eski maç adlarının ayrılması, oyuncu adı kontrolü |

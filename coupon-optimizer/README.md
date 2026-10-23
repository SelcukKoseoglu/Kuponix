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

1. Bütçeni gir ve seçimlerini ekle: maç, bahis, oran, min. maç, güven 1–10, isteğe bağlı not.
2. Risk tercihini seç ve **Kuponları öner**'e bas. Uygulama alternatif listesi değil, **tek bir kupon seti** önerir. Bu set tek bir kupon da olabilir, 2–4 normal/sistem kuponuna bölünmüş bir dağılım da.
3. Kuponları oynadıysan **Bu kuponları oynadım, kaydet** ile kaydet. Kayıt, maçların o anki oranlarını saklar.
4. Maçlar bittikçe seçimler listesinde her maçı **Tuttu / Tutmadı / İade** olarak işaretle. **Oynadığım kuponlar** bölümü şunları gösterir:
   - her kuponun dönüşünü,
   - setin net kâr/zararını,
   - sonuçlanan tüm setlerin toplamını.

## Öneri nasıl hesaplanır?

“Hepsini tek kupona mı yatırmalı, yoksa bölmeli mi?” sorusunun cevabı her maçın tutma ihtimaline bağlıdır. Uygulamada bu ihtimalin tek kaynağı senin güven puanındır.

- **Öznel olasılık:** `güven / 10` (7 → %70), en fazla %95. Maçlar birbirinden bağımsız sayılır. Bu gerçek bir olasılık değildir; öneri, tahminlerin ne kadar isabetliyse o kadar iyidir.
- **Aday kuponlar:**
  - 1–4 maçlık normal kuponlar,
  - 3–5 maçlık tüm geçerli `Sistem k,…,n` kuponları.

  Aynı maçtan iki seçim aynı kupona konmaz. Min. maç kuralına uymayan kolonlar atılır.
- **Ortak hareket:** Aday kuponların ödemeleri, havuzdaki maçların tüm 2^m sonucu üzerinden hesaplanır. Böylece aynı maçı paylaşan kuponların birlikte kazanıp kaybettiği hesaba katılır.
- **Hedef:** `beklenen dönüş − λ × standart sapma`. λ risk tercihine göre değişir:

  | Risk tercihi | λ | Tipik sonuç |
  |---|---|---|
  | Temkinli | 1 | Bütçe birkaç kupona yayılır, hiç dönüş alamama ihtimali düşer |
  | Dengeli | 0,5 | Beklenen kâr ile risk dengelenir |
  | Maksimum beklenen kâr | 0 | Genellikle bütçenin tamamı beklenen dönüşü en yüksek tek kupona gider |

- **Dağıtım:** Bütçe birimlere bölünür: 200 TL ve üstünde 10 TL, 50–200 TL arasında 5 TL, daha azında 1 TL. Birimler, hedefi en çok artıran kuponlara açgözlü yöntemle dağıtılır. Sonra kuponlar arasında tutar aktarılarak yerel iyileştirme yapılır ve en iyi sonuç birkaç farklı başlangıçtan seçilir.
- **Kısıtlar:**
  - en fazla 4 kupon,
  - normal kupon en az 50 TL,
  - toplam tutar bütçeyi aşmaz ve bütçenin tamamı dağıtılır (sistem kolonlarının kuruş yuvarlaması hariç).
- **Karşılaştırma:** Önerinin yanında, bütçenin tamamını tek normal veya tek sistem kuponuna koymanın beklenen dönüşü, kâr ihtimali ve sıfır dönüş ihtimali gösterilir. Böylece önerinin nedeni görülebilir.
- **Havuz sınırı:** Sonucu işaretlenmiş maçlar yeni öneriye alınmaz. 12'den fazla bekleyen seçim varsa `güven × oran` değeri en yüksek 12 seçim değerlendirilir.
- **Negatif beklenti:** Güven puanlarına göre bile beklenen dönüş yatırımın altındaysa uyarı gösterilir.

## Kupon kuralları

- **Normal kupon:**
  - En az 50 TL.
  - Dönüş = tutar × oranların çarpımı.
  - Kupondaki maç sayısı her seçimin min. maç değerine eşit veya ondan büyük olmalıdır.
- **Sistem kuponu:**
  - `Sistem k,…,n`: n seçimin k'lı, …, n'li tüm kombinasyonları. Kolon sayısı = Σ C(n, j).
  - Min. maç kuralı her kolon için ayrı uygulanır ve geçersiz kolonlar atılır.
  - Tutar geçerli kolonlara bölünür ve kolon başına tutar kuruşa aşağı yuvarlanır.
  - Kolon başına asgari tutar varsayılmaz (1 kuruş); platform kurallarını ayrıca kontrol et.
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
  components/        Bütçe alanı, risk seçici, istatistik kutusu, sorumlu oyun notu
  features/
    selections/      Seçim formu, seçim listesi, Tuttu/Tutmadı/İade düğmesi
    plans/           Önerilen kupon seti, kupon özetleri, detay ve tutar düzenleme
    slips/           Oynanan kuponlar ve kâr/zarar
    data/            JSON dışa/içe aktarma, temizleme
  lib/
    money.ts         Kuruş bazlı para işlemleri
    validation.ts    Doğrulamalar
    combinatorics.ts Kombinasyonlar, sistem kolon sayısı
    calculator.ts    Normal/sistem kupon hesapları
    plan.ts          Kupon setini doğrulayıp hesaplar
    probability.ts   Öznel olasılık modeli, dağılım istatistikleri
    optimizer.ts     Bütçe dağılımı optimizasyonu
    settlement.ts    Maç sonuçlarına göre kupon dönüşü ve kâr/zarar
    storage.ts       localStorage, JSON şeması, sürüm geçişi
```

## Testler

`npm test`, 5 dosyada 50 test çalıştırır:

| Dosya | Kapsam |
|---|---|
| `calculator.test.ts` | Oran çarpımı ve dönüş, Sistem 3,4 = 5 kolon, min. maç kolon dışlama, 50 TL sınırı, kuruş yuvarlama |
| `optimizer.test.ts` | Bütçe aşılmaması, tek öneri, risk tercihlerinin etkisi, tek kupon karşılaştırması, sonuçlanmış maçların dışlanması, aynı maç kısıtı, 12+ seçimde performans |
| `settlement.test.ts` | Tuttu/tutmadı/iade/bekliyor durumlarında normal ve sistem kupon dönüşü, kâr/zarar; öznel olasılık istatistikleri |
| `storage.test.ts` | JSON içe/dışa aktarma, sürüm 1 kayıtlarının okunması, bozuk kaydın yedeklenmesi |
| `validation.test.ts` | Oran, güven, min. maç ve bütçe validasyonları |

export function ResponsibleNote() {
  return (
    <div className="rounded-xl border border-amber-700/50 bg-amber-950/40 p-4 text-sm text-amber-100">
      <p className="font-semibold">Sorumlu kullanım notu</p>
      <p className="mt-1">
        Kuponix yalnızca kullanıcının girdiği verilerle matematiksel senaryolar oluşturur. Tahminler ve simülasyonlar belirsizlik
        içerir; kazanç garantisi vermez. Yalnızca kaybetmeyi göze alabileceğiniz tutarı kullanın.
      </p>
      <p className="mt-2 text-amber-200/80">
        Kuponix maç sonucu tahmin etmez ve sizin yerinize bahis oynamaz. Tahmini olasılıklar sizin girdilerinizdir; güven puanı bir
        olasılık değildir. Dönüşler kesinti, vergi ve platform kuralları hariç teorik brüt tutarlardır; sistem formatlarının ve kolon
        tutarlarının platformunuzda geçerli olduğunu ayrıca kontrol edin.
      </p>
    </div>
  );
}

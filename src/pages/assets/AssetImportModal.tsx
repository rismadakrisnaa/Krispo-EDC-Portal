import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { describeError } from '../../lib/firebase';
import { ASSET_TYPE_LABEL, type AssetType } from '../../lib/constants';
import { IMPORT_TEMPLATES, importAssets, type ImportResult } from '../../lib/assets';
import { readExcel, writeExcel } from '../../lib/excel';
import { useData } from '../../context/DataContext';
import { FileDrop, Modal, btnSecondary, useFeedback } from '../../components/ui';

export function AssetImportModal({ open, onClose, assetType }: { open: boolean; onClose: () => void; assetType: AssetType }) {
  const { assets } = useData();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const close = () => { setResult(null); onClose(); };

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const rows = await readExcel(file);
      const outcome = await importAssets(rows, assetType, assets);
      setResult(outcome);
      toast(`${outcome.imported} ${ASSET_TYPE_LABEL[assetType]} diimpor.`, outcome.imported ? 'success' : 'info');
    } catch (error) {
      console.error(error);
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} busy={busy} title={`Import ${ASSET_TYPE_LABEL[assetType]}`} subtitle="Bulk import dari Excel">
      <div className="p-6 space-y-5">
        <div className="bg-brand-primary-light p-4 rounded-lg border border-brand-primary/20 text-xs text-brand-text-main leading-relaxed space-y-2">
          <p>Gunakan template supaya nama kolom sesuai. SN yang sudah terdaftar otomatis dilewati.</p>
          <button onClick={() => writeExcel(IMPORT_TEMPLATES[assetType], 'Template', `Template_Import_${assetType}.xlsx`)} className="flex items-center gap-2 font-bold text-brand-primary hover:underline">
            <Download size={14} /> Unduh Template {ASSET_TYPE_LABEL[assetType]}
          </button>
        </div>

        <FileDrop busy={busy} onFile={handleFile} />

        {result && (
          <div className="border border-brand-border rounded-xl p-4 text-xs space-y-2">
            <p className="font-bold text-brand-text-main">
              Hasil: {result.imported} diimpor · {result.linked} tautan dibuat · {result.skipped.length} catatan
            </p>
            {result.skipped.length > 0 && (
              <ul className="max-h-[140px] overflow-y-auto space-y-1 text-amber-700">
                {result.skipped.map((line, i) => <li key={i}>• {line}</li>)}
              </ul>
            )}
          </div>
        )}

        <button onClick={close} disabled={busy} className={`${btnSecondary} w-full py-3`}>{result ? 'Selesai' : 'Batal'}</button>
      </div>
    </Modal>
  );
}

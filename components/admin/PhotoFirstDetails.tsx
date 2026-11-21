'use client';

import { useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { uploadProductPhoto } from '@/lib/product-photo';

type Props = {
  /** The product's photos (first one is used for writing). */
  images: { url: string }[];
  /** Called with the addresses of photos uploaded from this panel. */
  onPhotosAdded: (urls: string[]) => void;
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
};

type Step = 'idle' | 'uploading' | 'writing' | 'done' | 'error';

/**
 * "Start with a photo": upload the product photo first and the name and
 * description are written from it (server: /api/admin/products/describe).
 * The fields stay ordinary inputs, so staff change anything that is wrong.
 */
export default function PhotoFirstDetails({
  images,
  onPhotosAdded,
  name,
  description,
  onNameChange,
  onDescriptionChange,
}: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [message, setMessage] = useState('');
  const [undo, setUndo] = useState<{ name: string; description: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = step === 'uploading' || step === 'writing';
  const firstPhoto = images[0]?.url;

  /** Ask the server to write both fields. `replace` overwrites text already typed. */
  const write = async (imageUrl: string, replace: boolean) => {
    setStep('writing');
    setMessage('');
    try {
      const result = await adminFetch<{ name: string; description: string }>('/api/admin/products/describe', {
        method: 'POST',
        body: JSON.stringify({ imageUrl }),
      });
      const before = { name, description };
      const fillName = !!result.name && (replace || !name.trim());
      const fillDescription = !!result.description && (replace || !description.trim());
      if (fillName) onNameChange(result.name);
      if (fillDescription) onDescriptionChange(result.description);
      if (!fillName && !fillDescription) {
        setStep('done');
        setMessage('Your name and description were kept. Tap "Write from photo" to replace them.');
        setUndo(null);
        return;
      }
      setUndo(replace && (before.name || before.description) ? before : null);
      setStep('done');
      setMessage('Written from the photo. Check it and change anything that is not right.');
    } catch (err: any) {
      setStep('error');
      setMessage(err?.message || 'The name and description could not be written. Type them instead.');
    }
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length === 0) return;
    setStep('uploading');
    setMessage('');
    const urls: string[] = [];
    let failure = '';
    for (const file of files) {
      try {
        urls.push(await uploadProductPhoto(file));
      } catch (err: any) {
        failure = err?.message || 'A photo did not upload.';
      }
    }
    if (urls.length > 0) onPhotosAdded(urls);
    if (urls.length === 0) {
      setStep('error');
      setMessage(failure || 'The photo did not upload. Try again.');
      return;
    }
    await write(firstPhoto || urls[0], false);
  };

  const restore = () => {
    if (!undo) return;
    onNameChange(undo.name);
    onDescriptionChange(undo.description);
    setUndo(null);
    setStep('idle');
    setMessage('');
  };

  return (
    <section
      aria-labelledby="photo-first-title"
      className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/60 p-4 sm:p-5"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-lg border border-blue-100 bg-white sm:h-20 sm:w-20">
          {firstPhoto ? (
            <img src={firstPhoto} alt="" className="h-full w-full object-cover" />
          ) : (
            <i className="ri-image-add-line text-3xl text-blue-600" aria-hidden="true"></i>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="photo-first-title" className="font-semibold text-gray-900">
            {firstPhoto ? 'Write the details from the photo' : 'Start with a photo'}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            {firstPhoto
              ? 'We read the first photo and write the product name and description. You can change them after.'
              : 'Add the product photo and we write the name and description for you. You can change them after.'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label
          className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700 ${
            firstPhoto
              ? 'border-2 border-gray-300 bg-white text-gray-800 hover:border-blue-700 hover:text-blue-700'
              : 'bg-blue-700 text-white hover:bg-blue-800'
          } ${busy ? 'pointer-events-none opacity-60' : ''}`}
        >
          <i className="ri-camera-line text-lg" aria-hidden="true"></i>
          {firstPhoto ? 'Add another photo' : 'Add photo'}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={handleFiles}
            disabled={busy}
          />
        </label>

        {firstPhoto && (
          <button
            type="button"
            onClick={() => write(firstPhoto, true)}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <i className="ri-quill-pen-line text-lg" aria-hidden="true"></i>
            Write from photo
          </button>
        )}
      </div>

      <div aria-live="polite" className="mt-3 text-sm empty:hidden">
        {busy && (
          <p className="flex items-center gap-2 text-blue-800">
            <i className="ri-loader-4-line animate-spin" aria-hidden="true"></i>
            {step === 'uploading' ? 'Uploading the photo...' : 'Reading the photo and writing...'}
          </p>
        )}
        {!busy && message && (
          <p className={step === 'error' ? 'text-red-700' : 'text-gray-700'} role={step === 'error' ? 'alert' : undefined}>
            {message}{' '}
            {undo && (
              <button
                type="button"
                onClick={restore}
                className="inline-flex min-h-[44px] items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
              >
                Undo
              </button>
            )}
            {step === 'error' && firstPhoto && (
              <button
                type="button"
                onClick={() => write(firstPhoto, true)}
                className="inline-flex min-h-[44px] items-center font-semibold text-red-800 underline underline-offset-2 hover:text-red-900"
              >
                Try again
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

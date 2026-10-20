import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, Mail, Trash2, ArrowLeft } from 'lucide-react';
import { Contact, EmailTemplate } from '../types';
import { listEmailSenders, previewEmail, sendEmail, textToHtml, type EmailSender, type EmailPreview, type EmailDraft } from '../lib/email';
import { getEmailTemplates, saveEmailTemplate, deleteEmailTemplate } from '../lib/drizzle';

const PREFERRED_SENDER = 'post@vegr.ai';

const fieldClass =
  'w-full p-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl text-sm focus:ring-2 focus:ring-[#4F46E5] outline-none';
const labelClass = 'block text-xs font-bold text-[#9CA3AF] uppercase tracking-wider mb-2';
const secondaryBtn =
  'px-4 py-3 bg-[#F3F4F6] hover:bg-[#EEF2FF] text-[#4B5563] hover:text-[#4F46E5] rounded-xl text-sm font-semibold transition-colors disabled:opacity-50';

interface Props {
  contact: Contact;
  onClose: () => void;
  templatesTableId: string | null;
  templates: EmailTemplate[];
  onTemplatesChange: (templates: EmailTemplate[]) => void;
}

/**
 * Compose → Preview → Send. The preview is what the e-mail service will deliver, byte for byte
 * (dev-worker renders both from the same function), so Send only appears once it has been seen.
 */
export default function EmailModal({ contact, onClose, templatesTableId, templates, onTemplatesChange }: Props) {
  const [senders, setSenders] = useState<EmailSender[]>([]);
  const [sendersLoading, setSendersLoading] = useState(true);
  const [fromEmail, setFromEmail] = useState('');
  const [toEmail, setToEmail] = useState(contact.emails?.[0]?.value || '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<string | null>(null);

  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  useEffect(() => {
    listEmailSenders()
      .then(list => {
        setSenders(list);
        const preferred = list.find(s => s.email.toLowerCase() === PREFERRED_SENDER);
        setFromEmail((preferred || list[0])?.email || '');
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load sender addresses'))
      .finally(() => setSendersLoading(false));
  }, []);

  const draft = (): EmailDraft => ({
    fromEmail,
    toEmail: toEmail.trim(),
    subject: subject.trim(),
    bodyHtml: textToHtml(message),
    // The message is written whole, sign-off included, so no World signature is appended.
    signature: 'none',
  });

  const canPreview = !!fromEmail && !!toEmail.trim() && !!subject.trim() && !!message.trim() && !busy;

  const handlePreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewEmail(draft()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await sendEmail(draft());
      setSentInfo(`Sent to ${r.toEmail} from ${r.senderEmail}.`);
      setTimeout(onClose, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sending failed');
    } finally {
      setBusy(false);
    }
  };

  const loadTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const t = templates.find(x => x.id === id);
    if (!t) return;
    if (t.subject) setSubject(t.subject);
    setMessage(t.message);
    setPreview(null);
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim() || !templatesTableId) return;
    try {
      await saveEmailTemplate(templatesTableId, templateName.trim(), subject, message);
      onTemplatesChange(await getEmailTemplates(templatesTableId));
      setTemplateName('');
      setShowSaveTemplate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    }
  };

  const handleDeleteTemplate = async () => {
    const t = templates.find(x => x.id === selectedTemplateId);
    if (!t || !templatesTableId) return;
    if (!window.confirm(`Delete the template "${t.name}"?`)) return;
    try {
      await deleteEmailTemplate(templatesTableId, t.id);
      onTemplatesChange(await getEmailTemplates(templatesTableId));
      setSelectedTemplateId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={busy ? undefined : onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl"
      >
        <div className="p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight">{preview ? 'Check and send' : 'Send e-mail'}</h2>
              <p className="text-sm text-[#6B7280] mt-1">{contact.fullName}</p>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="p-2 hover:bg-[#F3F4F6] rounded-full text-[#6B7280]">
              <X size={20} />
            </button>
          </div>

          {!preview ? (
            <>
              {/* From */}
              <div className="mb-5">
                <label className={labelClass}>From</label>
                {sendersLoading ? (
                  <p className="text-sm text-[#9CA3AF]">Loading sender addresses…</p>
                ) : senders.length === 0 ? (
                  <p className="text-sm text-red-700">You have no address you are allowed to send from.</p>
                ) : (
                  <select value={fromEmail} onChange={e => setFromEmail(e.target.value)} className={fieldClass}>
                    {senders.map(s => (
                      <option key={s.email} value={s.email}>
                        {s.fromName && s.fromName !== s.email ? `${s.fromName} <${s.email}>` : s.email}
                        {s.basis === 'grant' ? ` (granted by ${s.grantedBy})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* To */}
              <div className="mb-5">
                <label className={labelClass}>To</label>
                {contact.emails && contact.emails.length > 1 ? (
                  <select value={toEmail} onChange={e => setToEmail(e.target.value)} className={fieldClass}>
                    {contact.emails.map((em, i) => (
                      <option key={i} value={em.value}>{em.label}: {em.value}</option>
                    ))}
                  </select>
                ) : (
                  <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)} className={fieldClass} />
                )}
              </div>

              {/* Templates */}
              {templates.length > 0 && (
                <div className="mb-5">
                  <label className={labelClass}>Templates</label>
                  <div className="flex gap-2">
                    <select value={selectedTemplateId} onChange={e => loadTemplate(e.target.value)} className={fieldClass}>
                      <option value="">Load a template...</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleDeleteTemplate}
                      disabled={!selectedTemplateId}
                      title="Delete selected template"
                      aria-label="Delete selected template"
                      className="px-3 bg-[#F3F4F6] hover:bg-red-50 text-[#6B7280] hover:text-red-600 rounded-xl transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* Subject */}
              <div className="mb-5">
                <label className={labelClass}>Subject</label>
                <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className={fieldClass} />
              </div>

              {/* Message */}
              <div className="mb-5">
                <label className={labelClass}>Message</label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Type your message here..."
                  rows={8}
                  className={`${fieldClass} resize-y`}
                />
              </div>

              {showSaveTemplate && (
                <div className="mb-5 p-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl">
                  <label className={labelClass}>Template Name</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={templateName}
                      onChange={e => setTemplateName(e.target.value)}
                      placeholder="e.g., Booking"
                      className="flex-1 p-2 bg-white border border-[#E5E7EB] rounded-lg text-sm focus:ring-2 focus:ring-[#4F46E5] outline-none"
                    />
                    <button type="button" onClick={handleSaveTemplate} className="px-3 py-2 bg-[#4F46E5] text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowSaveTemplate(false); setTemplateName(''); }}
                      className="px-3 py-2 bg-white border border-[#E5E7EB] text-[#6B7280] rounded-lg text-sm font-semibold hover:bg-[#F3F4F6] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="mb-5 space-y-3">
              <div className="text-sm">
                <p><span className="text-[#9CA3AF]">From:</span> {preview.fromName && preview.fromName !== preview.senderEmail ? `${preview.fromName} <${preview.senderEmail}>` : preview.senderEmail}</p>
                <p><span className="text-[#9CA3AF]">To:</span> {preview.toEmail}</p>
                <p><span className="text-[#9CA3AF]">Subject:</span> <strong>{preview.subject}</strong></p>
              </div>
              <iframe
                title="E-mail preview"
                sandbox=""
                srcDoc={preview.html}
                className="w-full h-72 border border-[#E5E7EB] rounded-xl bg-white"
              />
              {preview.warnings?.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  {preview.warnings.map((w, i) => <p key={i}>{w}</p>)}
                </div>
              )}
              {preview.unresolvedPlaceholders?.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  Unfilled placeholders: {preview.unresolvedPlaceholders.map(p => `{${p}}`).join(', ')}. Sending will be refused.
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}
          {sentInfo && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">✓ {sentInfo}</div>
          )}

          <div className="flex gap-2">
            {!preview ? (
              <>
                <button type="button" onClick={onClose} disabled={busy} className={secondaryBtn}>Cancel</button>
                <button
                  type="button"
                  onClick={() => setShowSaveTemplate(!showSaveTemplate)}
                  disabled={!message.trim() || showSaveTemplate || !templatesTableId}
                  className={secondaryBtn}
                >
                  Save Template
                </button>
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={!canPreview || showSaveTemplate}
                  className="flex-1 px-4 py-3 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {busy ? 'Rendering…' : 'Preview'}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setPreview(null)} disabled={busy || !!sentInfo} className={`${secondaryBtn} flex items-center gap-1`}>
                  <ArrowLeft size={16} /> Edit
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy || !!sentInfo || preview.unresolvedPlaceholders?.length > 0}
                  className="flex-1 px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {busy ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail size={16} />
                      Send e-mail
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

import { useState, useMemo, useRef, ChangeEvent } from 'react';
import { 
  Search, 
  Plus, 
  Upload, 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Briefcase, 
  Globe, 
  Trash2, 
  Filter, 
  X,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Calendar,
  FileText,
  Menu,
  MoreVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Contact } from './types';
import { parseGoogleContactsCSV } from './utils/csvParser';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    if (!importText.trim()) return;
    try {
      const newContacts = parseGoogleContactsCSV(importText);
      setContacts(prev => [...prev, ...newContacts]);
      setIsImportModalOpen(false);
      setImportText('');
      setError(null);
    } catch (err) {
      setError('Failed to parse CSV. Please check the format.');
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const newContacts = parseGoogleContactsCSV(text);
        setContacts(prev => [...prev, ...newContacts]);
        setError(null);
      } catch (err) {
        setError('Failed to parse CSV file.');
      }
    };
    reader.readAsText(file);
  };

  const handleDeleteContact = (id: string) => {
    setContacts(prev => prev.filter(c => c.id !== id));
    if (selectedContactId === id) {
      setSelectedContactId(null);
    }
  };

  const handleClearAll = () => {
    setContacts([]);
    setSelectedContactId(null);
    setActiveLabel(null);
  };

  const allLabels = useMemo(() => {
    const labels = new Set<string>();
    contacts.forEach(c => c.labels.forEach(l => labels.add(l)));
    return Array.from(labels).sort();
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    return contacts.filter(c => {
      const matchesSearch = 
        c.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.emails.some(e => e.value.toLowerCase().includes(searchQuery.toLowerCase())) ||
        c.phones.some(p => p.value.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesLabel = !activeLabel || c.labels.includes(activeLabel);
      
      return matchesSearch && matchesLabel;
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [contacts, searchQuery, activeLabel]);

  const selectedContact = contacts.find(c => c.id === selectedContactId);

  return (
    <div className="flex h-screen bg-[#F9FAFB] text-[#111827] font-sans">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-white border-r border-[#E5E7EB] overflow-hidden flex-shrink-0"
      >
        <div className="p-6 h-full flex flex-col">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-[#4F46E5] rounded-xl flex items-center justify-center text-white">
              <User size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">ContactHub</h1>
          </div>

          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="w-full py-3 px-4 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-xl font-medium transition-all flex items-center justify-center gap-2 mb-8 shadow-sm"
          >
            <Plus size={20} />
            Import Contacts
          </button>

          <nav className="space-y-1 flex-1 overflow-y-auto">
            <button 
              onClick={() => setActiveLabel(null)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
                !activeLabel ? "bg-[#F3F4F6] text-[#4F46E5]" : "text-[#6B7280] hover:bg-[#F9FAFB]"
              )}
            >
              <User size={18} />
              All Contacts
              <span className="ml-auto text-xs opacity-60">{contacts.length}</span>
            </button>

            <div className="pt-4 pb-2 px-4 text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">
              Labels
            </div>
            
            {allLabels.map(label => (
              <button 
                key={label}
                onClick={() => setActiveLabel(label)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  activeLabel === label ? "bg-[#F3F4F6] text-[#4F46E5]" : "text-[#6B7280] hover:bg-[#F9FAFB]"
                )}
              >
                <Filter size={18} />
                {label}
                <span className="ml-auto text-xs opacity-60">
                  {contacts.filter(c => c.labels.includes(label)).length}
                </span>
              </button>
            ))}

            {contacts.length > 0 && (
              <button 
                onClick={handleClearAll}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 transition-colors mt-4"
              >
                <Trash2 size={18} />
                Clear All Contacts
              </button>
            )}
          </nav>

          <div className="mt-auto pt-6 border-t border-[#F3F4F6]">
            <div className="flex items-center gap-3 px-4 py-2 opacity-60">
              <div className="w-8 h-8 rounded-full bg-[#E5E7EB] flex items-center justify-center">
                <User size={16} />
              </div>
              <div className="text-xs">
                <p className="font-semibold">User Account</p>
                <p>torarnehave@gmail.com</p>
              </div>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 bg-white border-bottom border-[#E5E7EB] flex items-center px-6 gap-4 sticky top-0 z-10">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-[#F3F4F6] rounded-lg text-[#6B7280]"
          >
            <Menu size={20} />
          </button>
          
          <div className="relative flex-1 max-w-2xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={18} />
            <input 
              type="text" 
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#F3F4F6] border-none rounded-xl text-sm focus:ring-2 focus:ring-[#4F46E5] outline-none transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <input 
              type="file" 
              accept=".csv" 
              onChange={handleFileUpload} 
              className="hidden" 
              ref={fileInputRef}
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-2 hover:bg-[#F3F4F6] rounded-lg text-[#6B7280] flex items-center gap-2 text-sm font-medium"
            >
              <Upload size={18} />
              <span className="hidden sm:inline">Upload CSV</span>
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Contact List */}
          <div className="w-full md:w-[400px] border-r border-[#E5E7EB] bg-white overflow-y-auto">
            {filteredContacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center opacity-40">
                <User size={48} className="mb-4" />
                <p className="text-sm font-medium">No contacts found</p>
                <p className="text-xs mt-1">Try importing some contacts or changing your search.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#F3F4F6]">
                {filteredContacts.map(contact => (
                  <button
                    key={contact.id}
                    onClick={() => setSelectedContactId(contact.id)}
                    className={cn(
                      "w-full p-4 flex items-center gap-4 text-left transition-all hover:bg-[#F9FAFB]",
                      selectedContactId === contact.id && "bg-[#F3F4F6] border-l-4 border-l-[#4F46E5]"
                    )}
                  >
                    <div className="w-12 h-12 rounded-full bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5] font-bold text-lg overflow-hidden flex-shrink-0">
                      {contact.photo ? (
                        <img src={contact.photo} alt={contact.fullName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        contact.fullName.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-sm truncate">{contact.fullName}</h3>
                      <p className="text-xs text-[#6B7280] truncate">
                        {contact.phones[0]?.value || contact.emails[0]?.value || 'No contact info'}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-[#D1D5DB]" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Contact Detail */}
          <div className="hidden md:flex flex-1 bg-white overflow-y-auto">
            <AnimatePresence mode="wait">
              {selectedContact ? (
                <motion.div 
                  key={selectedContact.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="w-full max-w-3xl mx-auto p-12"
                >
                  <div className="flex items-start justify-between mb-12">
                    <div className="flex items-center gap-8">
                      <div className="w-32 h-32 rounded-3xl bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5] font-bold text-4xl overflow-hidden shadow-lg border-4 border-white">
                        {selectedContact.photo ? (
                          <img src={selectedContact.photo} alt={selectedContact.fullName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          selectedContact.fullName.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <h2 className="text-3xl font-bold tracking-tight mb-2">{selectedContact.fullName}</h2>
                        {selectedContact.nickname && (
                          <p className="text-lg text-[#6B7280] mb-4">"{selectedContact.nickname}"</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {selectedContact.labels.map(label => (
                            <span key={label} className="px-3 py-1 bg-[#F3F4F6] text-[#4B5563] text-xs font-semibold rounded-full uppercase tracking-wider">
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleDeleteContact(selectedContact.id)}
                        className="p-2 hover:bg-red-50 hover:text-red-600 rounded-lg text-[#6B7280] transition-colors"
                        title="Delete Contact"
                      >
                        <Trash2 size={20} />
                      </button>
                      <button className="p-2 hover:bg-[#F3F4F6] rounded-lg text-[#6B7280]">
                        <MoreVertical size={20} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    <div className="space-y-10">
                      {/* Contact Info */}
                      <section>
                        <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Contact Information</h4>
                        <div className="space-y-6">
                          {selectedContact.phones.map((phone, i) => (
                            <div key={i} className="flex items-center gap-4 group">
                              <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                                <Phone size={18} />
                              </div>
                              <div>
                                <p className="text-sm font-semibold">{phone.value}</p>
                                <p className="text-xs text-[#9CA3AF]">{phone.label}</p>
                              </div>
                            </div>
                          ))}
                          {selectedContact.emails.map((email, i) => (
                            <div key={i} className="flex items-center gap-4 group">
                              <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                                <Mail size={18} />
                              </div>
                              <div>
                                <p className="text-sm font-semibold">{email.value}</p>
                                <p className="text-xs text-[#9CA3AF]">{email.label}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>

                      {/* Work */}
                      {(selectedContact.organization.name || selectedContact.organization.title) && (
                        <section>
                          <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Work</h4>
                          <div className="flex items-center gap-4 group">
                            <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                              <Briefcase size={18} />
                            </div>
                            <div>
                              <p className="text-sm font-semibold">
                                {selectedContact.organization.title}
                                {selectedContact.organization.name && ` at ${selectedContact.organization.name}`}
                              </p>
                              <p className="text-xs text-[#9CA3AF]">{selectedContact.organization.department || 'Organization'}</p>
                            </div>
                          </div>
                        </section>
                      )}

                      {/* Websites */}
                      {selectedContact.websites.length > 0 && (
                        <section>
                          <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Websites</h4>
                          <div className="space-y-4">
                            {selectedContact.websites.map((site, i) => (
                              <a 
                                key={i} 
                                href={site.value.startsWith('http') ? site.value : `https://${site.value}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex items-center gap-4 group hover:opacity-80 transition-opacity"
                              >
                                <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                                  <Globe size={18} />
                                </div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold">{site.value}</p>
                                  <ExternalLink size={14} className="text-[#9CA3AF]" />
                                </div>
                              </a>
                            ))}
                          </div>
                        </section>
                      )}
                    </div>

                    <div className="space-y-10">
                      {/* Addresses */}
                      {selectedContact.addresses.length > 0 && (
                        <section>
                          <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Addresses</h4>
                          <div className="space-y-6">
                            {selectedContact.addresses.map((addr, i) => (
                              <div key={i} className="flex items-start gap-4 group">
                                <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors flex-shrink-0">
                                  <MapPin size={18} />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold whitespace-pre-line">{addr.formatted}</p>
                                  <p className="text-xs text-[#9CA3AF] mt-1">{addr.label}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {/* Other Details */}
                      {(selectedContact.birthday || selectedContact.notes) && (
                        <section>
                          <h4 className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest mb-6">Other Details</h4>
                          <div className="space-y-6">
                            {selectedContact.birthday && (
                              <div className="flex items-center gap-4 group">
                                <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors">
                                  <Calendar size={18} />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold">{selectedContact.birthday}</p>
                                  <p className="text-xs text-[#9CA3AF]">Birthday</p>
                                </div>
                              </div>
                            )}
                            {selectedContact.notes && (
                              <div className="flex items-start gap-4 group">
                                <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] group-hover:bg-[#EEF2FF] group-hover:text-[#4F46E5] transition-colors flex-shrink-0">
                                  <FileText size={18} />
                                </div>
                                <div>
                                  <p className="text-sm text-[#4B5563] leading-relaxed italic">"{selectedContact.notes}"</p>
                                  <p className="text-xs text-[#9CA3AF] mt-1">Notes</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-12 opacity-20">
                  <User size={120} className="mb-6" />
                  <h2 className="text-2xl font-bold">Select a contact</h2>
                  <p className="max-w-xs mt-2">Choose a contact from the list to view their full details.</p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Error Notification */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3"
          >
            <X size={20} className="cursor-pointer" onClick={() => setError(null)} />
            <span className="text-sm font-medium">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsImportModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold tracking-tight">Import Google Contacts</h2>
                  <button 
                    onClick={() => setIsImportModalOpen(false)}
                    className="p-2 hover:bg-[#F3F4F6] rounded-full text-[#6B7280]"
                  >
                    <X size={20} />
                  </button>
                </div>
                
                <p className="text-sm text-[#6B7280] mb-6">
                  Paste the content of your Google Contacts CSV export below. 
                  The app will automatically parse names, phones, emails, and addresses.
                </p>

                <textarea 
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="First Name,Middle Name,Last Name,..."
                  className="w-full h-64 p-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-xs font-mono focus:ring-2 focus:ring-[#4F46E5] outline-none resize-none mb-6"
                />

                <div className="flex gap-3">
                  <button 
                    onClick={() => setIsImportModalOpen(false)}
                    className="flex-1 py-3 px-4 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#4B5563] rounded-xl font-medium transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleImport}
                    disabled={!importText.trim()}
                    className="flex-1 py-3 px-4 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Parse & Import
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

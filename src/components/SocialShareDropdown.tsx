import { useState, useRef, useEffect } from 'react'
import { Share2 } from 'lucide-react'
import { instagramV2, telegramV2, discordV2, twitterV2 } from '../assets/images'

const SocialShareDropdown = () => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const socialLinks = [
    { name: 'X', icon: twitterV2, url: 'https://x.com/the_prize_io' },
    { name: 'Telegram', icon: telegramV2, url: 'https://t.me/theprizeannouncements' },
    { name: 'Discord', icon: discordV2, url: 'https://discord.com/invite/theprize' },
    { name: 'Instagram', icon: instagramV2, url: 'https://www.instagram.com/theprize.io/' },
  ]

  const handleShare = (url: string) => {
    const shareUrl = encodeURIComponent(window.location.href)
    const shareText = encodeURIComponent('Check out ThePrize.io - Win amazing prizes!')
    
    window.open(url, '_blank', 'noopener,noreferrer')
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-[#3A3A3A] hover:bg-[#4A4A4A] rounded-lg p-3 flex items-center justify-center w-12 h-12 transition-colors"
        aria-label="Share on social media"
      >
        <Share2 className="w-5 h-5 text-white" />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 bg-[#232323] rounded-lg shadow-xl border border-white/10 py-2 z-50 min-w-[180px]">
          <div className="px-3 py-2 border-b border-white/10">
            <p className="text-white sequel-45 text-xs uppercase">Share</p>
          </div>
          {socialLinks.map((social) => (
            <a
              key={social.name}
              href={social.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-3 hover:bg-[#3A3A3A] transition-colors"
            >
              <img src={social.icon} alt={social.name} className="w-5 h-5 object-contain" />
              <span className="text-white sequel-45 text-sm">{social.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export default SocialShareDropdown

import { CopyCheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react';
import { Link } from 'react-router'
import { handleCopy } from '../utils/util';


interface PaymentStatusProps {
  onReturn: () => void;
  status: 'success' | 'error' | 'idle';
  paymentData: any
}

const PaymentStatus = ({ status, onReturn, paymentData }: PaymentStatusProps) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const { order_description, message: errorMessage, pay_address } = paymentData ?? {}
  const isSuccess = status == 'success'
  const borderColor = isSuccess ? 'border-[#E5EE00]' : 'border-[#EF008F]'
  const textColor = isSuccess ? 'text-[#DDE404]' : 'text-[#EF008F]'
  return (
    <div className={`border w-full py-4 text-center rounded-xl px-4 sm:px-6 ${borderColor}`}>
      <h3 className={`${textColor} sequel-95 uppercase text-xl sm:text-2xl mb-4 text-center`}>{isSuccess ? 'Success!' : 'Error'} </h3>

      {isSuccess ? <div>
        <p className="text-white sequel-45 text-sm sm:text-base"> {order_description}</p>
        <p className="text-white sequel-45 text-sm sm:text-base">Good Luck!</p>

        <p className="text-center sequel-45 text-white leading-relaxed text-xs mt-4">PLEASE SAVE YOUR WALLET ADDRESS TO YOUR ACCOUNT FOR PAYOUTS</p>
      </div> : <p className="text-white sequel-45 mb-6 capitalize text-sm sm:text-base">{errorMessage ? errorMessage + ". Transaction reverted, Try Again." : "Transaction reverted. Try Again."}</p>}

      {isSuccess ? <div className="space-y-3 sm:space-y-4 mt-6">
        <button
          type="button"
          className="bg-white w-full text-xs sm:text-base uppercase text-black sequel-95 hover:bg-white/90 px-6 py-2.5 sm:px-8 sm:py-3 cursor-pointer rounded-lg"
        >
          My Wallets
        </button>
        <Link to={'/competitions'}
          className="bg-[#E5EE00] block text-xs sm:text-base disabled:opacity-75 w-full uppercase text-black sequel-95 hover:bg-[#E5EE00]/90 px-6 py-2.5 sm:px-8 sm:py-3 cursor-pointer rounded-lg"
        >
          View Competitions
        </Link>
        <div className="flex justify-center gap-2 sm:gap-4 items-center py-2.5 sm:py-3.5 px-3 sm:px-8 border border-white rounded-lg">
          <p className="uppercase text-white text-xs sm:text-base sequel-95">Transaction Hash</p>
          <div onClick={() => handleCopy(0, pay_address, setCopiedIndex)}>
            {copiedIndex === 0 ? (
              <CopyCheckIcon className="text-[#DDE404]" size={17} />
            ) : (
              <CopyIcon color="#E5EE00" size={17} className='cursor-pointer' />
            )}
          </div>
        </div>
      </div> : <button
        onClick={onReturn}
        type="button"
        className="bg-transparent w-full text-xs sm:text-base uppercase text-white border border-white sequel-95 px-6 py-2.5 sm:px-8 sm:py-3 cursor-pointer rounded-lg"
      >
        Return
      </button>}

      {!isSuccess ?
        <Link to={''} className='underline text-white sequel-45 inline-block mt-6 text-sm'>
          <i className="ri-telegram-2-fill"></i> Community Support
        </Link>
        : ''}
    </div>
  )
}

export default PaymentStatus
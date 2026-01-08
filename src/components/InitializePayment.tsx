import { truncateString } from "../utils/util"

interface InitializePaymentProps {
    entryCount:number;
    competitionId:string;
    amount:number;
    onClose:() => void
    authenticated: boolean,
    loading:boolean;
    handleConnect: () => void
    handlePayment: () => void
}

const InitializePayment = ({entryCount, competitionId, amount, onClose, authenticated, loading, handleConnect, handlePayment}: InitializePaymentProps) => {
  return (
        <div className="space-y-4">
              <p className="text-white sequel-45 text-center leading-relaxed text-sm sm:text-base">
              You're getting <b className="text-[#E5EE00]">{entryCount}</b>{" "}
              {entryCount > 1 ? "entries" : "entry"} for{" "}
              <span className="">
                Competition #<b>{truncateString(competitionId)}</b>
              </span> <br />
              <span>Total Amount: </span>
              <b className="text-[#E5EE00]">${amount}</b>
              </p>
            <div className="flex sm:flex-row flex-col justify-center gap-3 sm:gap-4">
              <button
                onClick={onClose}
                type="button"
                className="bg-white w-full uppercase text-sm sm:text-base text-black sequel-95 hover:bg-white/90 px-6 py-2.5 sm:px-8 sm:py-3 cursor-pointer rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={authenticated ? handlePayment : handleConnect}
                disabled={loading}
                type="button"
                className="bg-[#E5EE00] disabled:opacity-75 w-full uppercase text-sm sm:text-base text-black sequel-95 hover:bg-[#E5EE00]/90 px-6 py-2.5 sm:px-8 sm:py-3 cursor-pointer rounded-lg"
              >
                {loading ? "Processing..." : authenticated ? "Confirm & Pay" : "Connect Wallet"}
              </button>
            </div>
          </div>
  )
}

export default InitializePayment

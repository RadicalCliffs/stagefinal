import { cashOutBg, responsiveCashOut } from '../assets/images'
import { useSectionTracking } from '../hooks/useSectionTracking'

const CashOutLikeAPro = () => {
  const sectionRef = useSectionTracking('cash_out_section');

  return (
    <div ref={sectionRef} className='mx-auto w-full max-w-7xl relative'>
        <img src={cashOutBg} alt="cashOutBg" className='md:block hidden w-full' loading="lazy" />
        <img src={responsiveCashOut} alt="cashOutBg" className='md:hidden block w-full max-h-[300px] object-cover rounded-3xl' loading="lazy" />
        {/* <div className='overlay md:hidden block absolute bg-black/40 md:rounded-3xl  rounded-[3rem] top-0 left-0 w-full h-full '></div> */}
        <div className='absolute xl:left-20 md:left-10 left-0 top-1/2 -translate-y-1/2 md:text-left text-center'>
            <h1 className='sequel-75 uppercase text-white xl:text-5xl sm:text-3xl text-2xl'>Cash Out <br /> Like a Pro!</h1>
            <p className='sequel-45 sm:leading-loose text-white sm:text-base text-sm sm:mt-5 mt-3 xl:w-5/12 lg:w-9/12 md:px-0 px-4 '>Seamlessly convert your winnings to a <span className='font-bold xl:text-lg'>Bitget Wallet Card</span> and use them online, in stores, or on the go. Instant access. Total freedom.</p>
            <a href='https://web3.bitget.com/en/card' target='_blank' rel='noopener noreferrer' className='bg-[#DDE404] sequel-95 xl:text-2xl text-base uppercase sm:pt-[10px] sm:pb-3 pt-3 pb-2 xl:px-7 px-4 rounded-xl border border-white xl:mt-10 cursor-pointer mt-6 hover:bg-[#dde404]/90 inline-block md:mx-0 mx-auto'>Get My Card</a>
        </div>
    </div>
  )
}

export default CashOutLikeAPro
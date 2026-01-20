import { applePay, bancontactLogo, blikLogo, googlePay, iDealLogo, interacLogo, masterCardLogo, pixLogo, sofortLogo, spelLogo, visaLogo } from '../assets/images'

const CardPayments = () => {
    return (
        <div className="flex flex-wrap justify-center items-center sm:gap-6 gap-3 lg:px-0 px-4 max-[400px]:px-2 py-6 sm:py-8">
            <img src={masterCardLogo} alt="Mastercard" title="Mastercard" className="rounded py-[5px] px-2" />
            <img src={visaLogo} alt="Visa" title="Visa" className="rounded py-[5px] px-2" />
            <img src={applePay} alt="Apple Pay" title="Apple Pay" className="rounded py-[5px] px-2" />
            <img src={googlePay} alt="Google Pay" title="Google Pay" className="rounded py-[5px] px-2" />
            <img src={pixLogo} alt="Pix" title="Pix" className='sm:block hidden rounded py-[5px] px-2' />
            <img src={interacLogo} alt="Interac" title="Interac" className='sm:block hidden rounded py-[5px] px-2' />
            <img src={iDealLogo} alt="iDeal" title="iDeal" className='sm:block hidden rounded py-[5px] px-2' />
            <img src={blikLogo} alt="Blik" title="Blik" className='sm:block hidden rounded py-[5px] px-2' />
            <img src={spelLogo} alt="Spel" title="Spel" className='sm:block hidden rounded py-[5px] px-2' />
            <img src={bancontactLogo} alt="Bancontact" title="Bancontact" className='sm:block hidden rounded py-[5px] px-2' />
            <img src={sofortLogo} alt="Sofort" title="Sofort" className='sm:block hidden rounded py-[5px] px-2' />
        </div>
    )
}

export default CardPayments
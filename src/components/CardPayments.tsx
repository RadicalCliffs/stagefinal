import { applePay, bancontactLogo, blikLogo, googlePay, iDealLogo, interacLogo, masterCardLogo, pixLogo, sofortLogo, spelLogo, visaLogo } from '../assets/images'

const CardPayments = () => {
    return (
        <div className="flex flex-wrap justify-center items-center sm:gap-6 gap-3 lg:px-0 px-4 max-[400px]:px-2">
            <img src={masterCardLogo} alt="Mastercard" title="Mastercard" />
            <img src={visaLogo} alt="Visa" title="Visa" />
            <img src={applePay} alt="Apple Pay" title="Apple Pay" />
            <img src={googlePay} alt="Google Pay" title="Google Pay" />
            <img src={pixLogo} alt="Pix" title="Pix" className='sm:block hidden' />
            <img src={interacLogo} alt="Interac" title="Interac" className='sm:block hidden' />
            <img src={iDealLogo} alt="iDeal" title="iDeal" className='sm:block hidden' />
            <img src={blikLogo} alt="Blik" title="Blik" className='sm:block hidden' />
            <img src={spelLogo} alt="Spel" title="Spel" className='sm:block hidden' />
            <img src={bancontactLogo} alt="Bancontact" title="Bancontact" className='sm:block hidden' />
            <img src={sofortLogo} alt="Sofort" title="Sofort" className='sm:block hidden' />
        </div>
    )
}

export default CardPayments
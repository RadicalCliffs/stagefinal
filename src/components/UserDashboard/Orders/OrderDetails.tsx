import DetailInfo from "../../DetailInfo";

const OrderDetails = () => {
  const fields = [
    { label: "Competition:", value: "1BTC Prize Giveaway" },
    { label: "Subtotal:", value: "$500" },
    { label: "Payment Currency:", value: "SOL" },
    { label: "Total:", value: "$500" },
    { label: "Wallet Address:", value: "QWDIOJSD894379AA" },
    { label: "Purchase Hash:", value: "77SDKCLSDKJLJSCSLDKJC91" },
    { label: "Ticket Hash:", value: "QWDIOJSDJLJSCSLDKJC91" },
  ];

  return (
    <DetailInfo
      title="Order No. 345674879"
      subtitle="Order placed on December 3rd 2024 and is currently completed"
      fields={fields}
      backTo="/dashboard/orders"
    />
  );
};

export default OrderDetails;
